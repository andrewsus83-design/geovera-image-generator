"""LoRA fine-tuning pipeline for Stable Diffusion XL.

Trains a LoRA adapter on custom image-caption pairs to produce
consistent, high-quality generations faithful to the training data.
"""

import math
import os
from pathlib import Path

import torch
import torch.nn.functional as F
from accelerate import Accelerator
from accelerate.utils import ProjectConfiguration, set_seed
from diffusers import AutoencoderKL, DDPMScheduler, StableDiffusionXLPipeline, UNet2DConditionModel
from diffusers.optimization import get_scheduler
from omegaconf import OmegaConf
from peft import LoraConfig, get_peft_model
from torch.utils.data import DataLoader
from tqdm import tqdm
from transformers import AutoTokenizer, CLIPTextModel, CLIPTextModelWithProjection

from src.utils.data_utils import ImageCaptionDataset


def load_models(config):
    """Load pretrained SDXL models."""
    model_id = config.model.pretrained_model
    dtype = torch.float16 if config.training.mixed_precision == "fp16" else torch.float32

    # Load tokenizers
    tokenizer_1 = AutoTokenizer.from_pretrained(model_id, subfolder="tokenizer", use_fast=False)
    tokenizer_2 = AutoTokenizer.from_pretrained(model_id, subfolder="tokenizer_2", use_fast=False)

    # Load text encoders
    text_encoder_1 = CLIPTextModel.from_pretrained(model_id, subfolder="text_encoder", torch_dtype=dtype)
    text_encoder_2 = CLIPTextModelWithProjection.from_pretrained(model_id, subfolder="text_encoder_2", torch_dtype=dtype)

    # Load VAE
    vae_id = config.model.vae_model or model_id
    if config.model.vae_model:
        vae = AutoencoderKL.from_pretrained(vae_id, torch_dtype=dtype)
    else:
        vae = AutoencoderKL.from_pretrained(model_id, subfolder="vae", torch_dtype=dtype)

    # Load UNet
    unet = UNet2DConditionModel.from_pretrained(model_id, subfolder="unet", torch_dtype=dtype)

    # Load noise scheduler
    noise_scheduler = DDPMScheduler.from_pretrained(model_id, subfolder="scheduler")

    # Freeze all models except UNet (which will get LoRA)
    vae.requires_grad_(False)
    text_encoder_1.requires_grad_(False)
    text_encoder_2.requires_grad_(False)

    return {
        "tokenizer_1": tokenizer_1,
        "tokenizer_2": tokenizer_2,
        "text_encoder_1": text_encoder_1,
        "text_encoder_2": text_encoder_2,
        "vae": vae,
        "unet": unet,
        "noise_scheduler": noise_scheduler,
    }


def setup_lora(unet, config):
    """Apply LoRA adapters to the UNet."""
    lora_config = LoraConfig(
        r=config.lora.rank,
        lora_alpha=config.lora.alpha,
        target_modules=list(config.lora.target_modules),
        lora_dropout=config.lora.dropout,
    )
    unet = get_peft_model(unet, lora_config)
    unet.print_trainable_parameters()
    return unet


def encode_prompt(batch, text_encoder_1, text_encoder_2, tokenizer_1, tokenizer_2):
    """Encode text prompts using both SDXL text encoders."""
    # We re-tokenize here for the second tokenizer
    captions = tokenizer_1.batch_decode(batch["input_ids"], skip_special_tokens=True)

    tokens_2 = tokenizer_2(
        captions,
        max_length=tokenizer_2.model_max_length,
        padding="max_length",
        truncation=True,
        return_tensors="pt",
    ).to(text_encoder_2.device)

    # Encode with both text encoders
    prompt_embeds_1 = text_encoder_1(batch["input_ids"].to(text_encoder_1.device), output_hidden_states=True)
    prompt_embeds_1 = prompt_embeds_1.hidden_states[-2]

    prompt_embeds_2 = text_encoder_2(tokens_2.input_ids, output_hidden_states=True)
    pooled_prompt_embeds = prompt_embeds_2[0]
    prompt_embeds_2 = prompt_embeds_2.hidden_states[-2]

    prompt_embeds = torch.cat([prompt_embeds_1, prompt_embeds_2], dim=-1)

    return prompt_embeds, pooled_prompt_embeds


def train(config_path):
    """Main training loop for LoRA fine-tuning."""
    config = OmegaConf.load(config_path)

    # Setup accelerator
    project_config = ProjectConfiguration(
        project_dir=config.training.output_dir,
        logging_dir=os.path.join(config.training.output_dir, "logs"),
    )
    accelerator = Accelerator(
        gradient_accumulation_steps=config.training.gradient_accumulation_steps,
        mixed_precision=config.training.mixed_precision,
        project_config=project_config,
    )

    set_seed(config.training.seed)

    # Load models
    print("Loading models...")
    models = load_models(config)
    tokenizer_1 = models["tokenizer_1"]
    tokenizer_2 = models["tokenizer_2"]
    text_encoder_1 = models["text_encoder_1"]
    text_encoder_2 = models["text_encoder_2"]
    vae = models["vae"]
    unet = models["unet"]
    noise_scheduler = models["noise_scheduler"]

    # Setup LoRA
    print("Setting up LoRA adapters...")
    unet = setup_lora(unet, config)

    if config.training.gradient_checkpointing:
        unet.enable_gradient_checkpointing()

    # Setup optimizer
    if config.training.use_8bit_adam:
        import bitsandbytes as bnb
        optimizer_cls = bnb.optim.AdamW8bit
    else:
        optimizer_cls = torch.optim.AdamW

    optimizer = optimizer_cls(
        unet.parameters(),
        lr=config.training.learning_rate,
        betas=(0.9, 0.999),
        weight_decay=1e-2,
        eps=1e-8,
    )

    # Setup dataset
    print("Loading dataset...")
    dataset = ImageCaptionDataset(
        data_dir=config.dataset.train_data_dir,
        tokenizer=tokenizer_1,
        resolution=config.training.resolution,
        center_crop=config.dataset.center_crop,
        random_flip=config.dataset.random_flip,
    )
    dataloader = DataLoader(
        dataset,
        batch_size=config.training.train_batch_size,
        shuffle=True,
        num_workers=4,
        pin_memory=True,
    )

    # Setup scheduler
    lr_scheduler = get_scheduler(
        config.training.lr_scheduler,
        optimizer=optimizer,
        num_warmup_steps=config.training.lr_warmup_steps * config.training.gradient_accumulation_steps,
        num_training_steps=config.training.max_train_steps * config.training.gradient_accumulation_steps,
    )

    # Prepare with accelerator
    unet, optimizer, dataloader, lr_scheduler = accelerator.prepare(
        unet, optimizer, dataloader, lr_scheduler
    )

    vae.to(accelerator.device)
    text_encoder_1.to(accelerator.device)
    text_encoder_2.to(accelerator.device)

    # Training loop
    print(f"Starting training for {config.training.max_train_steps} steps...")
    global_step = 0
    progress_bar = tqdm(total=config.training.max_train_steps, desc="Training")

    unet.train()
    while global_step < config.training.max_train_steps:
        for batch in dataloader:
            with accelerator.accumulate(unet):
                # Encode images to latent space
                with torch.no_grad():
                    latents = vae.encode(batch["pixel_values"].to(dtype=vae.dtype)).latent_dist.sample()
                    latents = latents * vae.config.scaling_factor

                # Sample noise
                noise = torch.randn_like(latents)
                timesteps = torch.randint(
                    0, noise_scheduler.config.num_train_timesteps,
                    (latents.shape[0],), device=latents.device
                ).long()

                # Add noise to latents
                noisy_latents = noise_scheduler.add_noise(latents, noise, timesteps)

                # Encode text
                with torch.no_grad():
                    prompt_embeds, pooled_prompt_embeds = encode_prompt(
                        batch, text_encoder_1, text_encoder_2, tokenizer_1, tokenizer_2
                    )

                # SDXL additional conditioning
                add_time_ids = torch.tensor([
                    [config.training.resolution, config.training.resolution, 0, 0,
                     config.training.resolution, config.training.resolution]
                ], device=latents.device, dtype=prompt_embeds.dtype).repeat(latents.shape[0], 1)

                added_cond_kwargs = {
                    "text_embeds": pooled_prompt_embeds,
                    "time_ids": add_time_ids,
                }

                # Predict noise
                model_pred = unet(
                    noisy_latents.to(dtype=unet.dtype),
                    timesteps,
                    encoder_hidden_states=prompt_embeds.to(dtype=unet.dtype),
                    added_cond_kwargs=added_cond_kwargs,
                ).sample

                # Calculate loss
                loss = F.mse_loss(model_pred.float(), noise.float(), reduction="mean")

                accelerator.backward(loss)
                if accelerator.sync_gradients:
                    accelerator.clip_grad_norm_(unet.parameters(), config.training.max_grad_norm)
                optimizer.step()
                lr_scheduler.step()
                optimizer.zero_grad()

            if accelerator.sync_gradients:
                global_step += 1
                progress_bar.update(1)
                progress_bar.set_postfix(loss=loss.item(), lr=lr_scheduler.get_last_lr()[0])

                # Log
                if global_step % config.logging.log_every == 0:
                    print(f"Step {global_step}: loss={loss.item():.4f}, lr={lr_scheduler.get_last_lr()[0]:.2e}")

                # Save checkpoint
                if global_step % config.training.save_steps == 0:
                    save_path = os.path.join(config.training.output_dir, f"checkpoint-{global_step}")
                    accelerator.save_state(save_path)
                    print(f"Saved checkpoint to {save_path}")

                if global_step >= config.training.max_train_steps:
                    break

    # Save final LoRA weights
    accelerator.wait_for_everyone()
    if accelerator.is_main_process:
        unwrapped_unet = accelerator.unwrap_model(unet)
        unwrapped_unet.save_pretrained(config.training.output_dir)
        print(f"LoRA weights saved to {config.training.output_dir}")

    accelerator.end_training()
    progress_bar.close()
    print("Training complete!")


if __name__ == "__main__":
    import sys
    config_path = sys.argv[1] if len(sys.argv) > 1 else "configs/train_config.yaml"
    train(config_path)

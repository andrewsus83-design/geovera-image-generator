"""Data preprocessing utilities for image-text dataset preparation."""

import os
from pathlib import Path

import torch
from PIL import Image
from torch.utils.data import Dataset
from torchvision import transforms


class ImageCaptionDataset(Dataset):
    """Dataset for image-caption pairs used in LoRA fine-tuning.

    Expected directory structure:
        data_dir/
            image1.png
            image1.txt       # caption file
            image2.jpg
            image2.txt
            ...
    """

    def __init__(self, data_dir, tokenizer, resolution=1024, center_crop=True, random_flip=True):
        self.data_dir = Path(data_dir)
        self.tokenizer = tokenizer
        self.resolution = resolution

        # Find all image files
        image_extensions = {".png", ".jpg", ".jpeg", ".webp", ".bmp"}
        self.image_paths = sorted(
            p for p in self.data_dir.iterdir()
            if p.suffix.lower() in image_extensions
        )

        if not self.image_paths:
            raise ValueError(f"No images found in {data_dir}")

        # Build transforms
        transform_list = [transforms.Resize(resolution, interpolation=transforms.InterpolationMode.BILINEAR)]
        if center_crop:
            transform_list.append(transforms.CenterCrop(resolution))
        if random_flip:
            transform_list.append(transforms.RandomHorizontalFlip())
        transform_list.extend([
            transforms.ToTensor(),
            transforms.Normalize([0.5], [0.5]),
        ])
        self.transform = transforms.Compose(transform_list)

    def __len__(self):
        return len(self.image_paths)

    def _load_caption(self, image_path):
        caption_path = image_path.with_suffix(".txt")
        if caption_path.exists():
            return caption_path.read_text().strip()
        return ""

    def __getitem__(self, idx):
        image_path = self.image_paths[idx]
        image = Image.open(image_path).convert("RGB")
        image = self.transform(image)

        caption = self._load_caption(image_path)
        tokens = self.tokenizer(
            caption,
            max_length=self.tokenizer.model_max_length,
            padding="max_length",
            truncation=True,
            return_tensors="pt",
        )

        return {
            "pixel_values": image,
            "input_ids": tokens.input_ids.squeeze(0),
            "attention_mask": tokens.attention_mask.squeeze(0),
        }


def prepare_dataset(raw_dir, processed_dir, resolution=1024):
    """Preprocess raw images: resize, validate, and save to processed directory."""
    raw_path = Path(raw_dir)
    processed_path = Path(processed_dir)
    processed_path.mkdir(parents=True, exist_ok=True)

    image_extensions = {".png", ".jpg", ".jpeg", ".webp", ".bmp"}
    processed_count = 0

    for img_file in raw_path.iterdir():
        if img_file.suffix.lower() not in image_extensions:
            continue

        try:
            img = Image.open(img_file).convert("RGB")

            # Resize maintaining aspect ratio, then center crop
            w, h = img.size
            scale = resolution / min(w, h)
            new_w, new_h = int(w * scale), int(h * scale)
            img = img.resize((new_w, new_h), Image.LANCZOS)

            # Center crop
            left = (new_w - resolution) // 2
            top = (new_h - resolution) // 2
            img = img.crop((left, top, left + resolution, top + resolution))

            # Save processed image
            output_path = processed_path / f"{img_file.stem}.png"
            img.save(output_path, "PNG")

            # Copy caption if exists
            caption_src = img_file.with_suffix(".txt")
            caption_dst = processed_path / f"{img_file.stem}.txt"
            if caption_src.exists():
                caption_dst.write_text(caption_src.read_text())

            processed_count += 1
        except Exception as e:
            print(f"Skipping {img_file.name}: {e}")

    print(f"Processed {processed_count} images to {processed_dir}")
    return processed_count

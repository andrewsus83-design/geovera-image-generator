from setuptools import setup, find_packages

setup(
    name="geovera-image-generator",
    version="0.1.0",
    packages=find_packages(),
    python_requires=">=3.10",
    install_requires=[
        # Core ML
        "torch>=2.1.0",
        "torchvision>=0.16.0",
        "transformers>=4.36.0",
        "diffusers>=0.25.0",
        "accelerate>=0.25.0",
        "safetensors>=0.4.0",
        "peft>=0.7.0",
        # ControlNet & IP-Adapter
        "controlnet-aux>=0.0.7",
        # Image processing
        "Pillow>=10.0.0",
        "opencv-python>=4.8.0",
        "albumentations>=1.3.0",
        # Data handling
        "datasets>=2.16.0",
        "numpy>=1.24.0",
        "pandas>=2.0.0",
        # Configuration
        "omegaconf>=2.3.0",
        "pyyaml>=6.0",
        # Gemini integration
        "google-generativeai>=0.3.0",
        # Supabase
        "supabase>=2.0.0",
        # CLI & utilities
        "click>=8.1.0",
        "tqdm>=4.66.0",
        "rich>=13.0.0",
    ],
    extras_require={
        "train": [
            "bitsandbytes>=0.41.0",
            "xformers>=0.0.23",
            "wandb>=0.16.0",
        ],
    },
    entry_points={
        "console_scripts": [
            "geovera=scripts.run_pipeline:cli",
        ],
    },
)

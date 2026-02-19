"""Image utility functions for preprocessing and evaluation."""

import cv2
import numpy as np
from PIL import Image
from pathlib import Path


def load_image(path, size=None):
    """Load and optionally resize an image."""
    img = Image.open(path).convert("RGB")
    if size:
        if isinstance(size, int):
            size = (size, size)
        img = img.resize(size, Image.LANCZOS)
    return img


def compute_ssim(img1, img2):
    """Compute Structural Similarity Index between two images.

    Higher SSIM = more similar (range 0-1).
    Useful for measuring how consistent generated images are with reference.
    """
    if isinstance(img1, Image.Image):
        img1 = np.array(img1)
    if isinstance(img2, Image.Image):
        img2 = np.array(img2)

    # Convert to grayscale
    if len(img1.shape) == 3:
        img1 = cv2.cvtColor(img1, cv2.COLOR_RGB2GRAY)
    if len(img2.shape) == 3:
        img2 = cv2.cvtColor(img2, cv2.COLOR_RGB2GRAY)

    # Ensure same size
    if img1.shape != img2.shape:
        img2 = cv2.resize(img2, (img1.shape[1], img1.shape[0]))

    C1 = (0.01 * 255) ** 2
    C2 = (0.03 * 255) ** 2

    img1 = img1.astype(np.float64)
    img2 = img2.astype(np.float64)

    mu1 = cv2.GaussianBlur(img1, (11, 11), 1.5)
    mu2 = cv2.GaussianBlur(img2, (11, 11), 1.5)

    mu1_sq = mu1 ** 2
    mu2_sq = mu2 ** 2
    mu1_mu2 = mu1 * mu2

    sigma1_sq = cv2.GaussianBlur(img1 ** 2, (11, 11), 1.5) - mu1_sq
    sigma2_sq = cv2.GaussianBlur(img2 ** 2, (11, 11), 1.5) - mu2_sq
    sigma12 = cv2.GaussianBlur(img1 * img2, (11, 11), 1.5) - mu1_mu2

    ssim_map = ((2 * mu1_mu2 + C1) * (2 * sigma12 + C2)) / \
               ((mu1_sq + mu2_sq + C1) * (sigma1_sq + sigma2_sq + C2))

    return float(ssim_map.mean())


def create_comparison_grid(reference, generated_images, captions=None, cols=4):
    """Create a side-by-side comparison grid of reference vs generated images."""
    images = [reference] + generated_images
    n = len(images)
    rows = (n + cols - 1) // cols

    # Get target size from first image
    w, h = images[0].size

    grid = Image.new("RGB", (cols * w, rows * h), (255, 255, 255))
    for i, img in enumerate(images):
        img = img.resize((w, h), Image.LANCZOS)
        row, col = divmod(i, cols)
        grid.paste(img, (col * w, row * h))

    return grid


def extract_edges(image, method="canny", low=100, high=200):
    """Extract edge maps for ControlNet conditioning."""
    if isinstance(image, Image.Image):
        image = np.array(image)

    if method == "canny":
        edges = cv2.Canny(image, low, high)
    elif method == "hed":
        # Placeholder for HED edge detection
        gray = cv2.cvtColor(image, cv2.COLOR_RGB2GRAY)
        edges = cv2.Canny(gray, low, high)
    else:
        raise ValueError(f"Unknown edge method: {method}")

    return Image.fromarray(edges).convert("RGB")

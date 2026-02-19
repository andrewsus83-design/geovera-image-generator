"""Prop image compositor for consistent product/object placement.

Ensures uploaded prop images (products, accessories, objects) remain
visually consistent and unaltered across all generated theme variations.

Uses IP-Adapter for style/identity matching and image compositing
to overlay the prop onto generated scenes.
"""

import io
from pathlib import Path

import cv2
import numpy as np
from PIL import Image


class PropCompositor:
    """Manages prop images and composites them onto generated scenes."""

    def __init__(self):
        self.prop_image = None
        self.prop_mask = None
        self.prop_description = None

    def load_prop(self, image_path, description=None):
        """Load a prop image for consistent placement.

        Args:
            image_path: Path to the prop image (ideally with transparent background
                        or clean background for easy extraction).
            description: Text description of the prop (used in prompts).

        Returns:
            self for chaining.
        """
        self.prop_image = Image.open(image_path).convert("RGBA")
        self.prop_description = description or "the product"

        # Auto-generate mask (remove background)
        self.prop_mask = self._extract_mask(self.prop_image)

        return self

    def _extract_mask(self, image):
        """Extract foreground mask from prop image.

        Handles both transparent PNGs and solid-background images.
        """
        img_array = np.array(image)

        # If image has alpha channel, use it as mask
        if img_array.shape[2] == 4:
            alpha = img_array[:, :, 3]
            mask = (alpha > 128).astype(np.uint8) * 255
        else:
            # Try to extract via GrabCut or simple thresholding
            rgb = img_array[:, :, :3]
            gray = cv2.cvtColor(rgb, cv2.COLOR_RGB2GRAY)

            # Edge-based detection for clean backgrounds
            edges = cv2.Canny(gray, 50, 150)
            kernel = np.ones((5, 5), np.uint8)
            edges = cv2.dilate(edges, kernel, iterations=2)

            # Flood fill from corners to detect background
            h, w = gray.shape
            flood_mask = np.zeros((h + 2, w + 2), np.uint8)
            cv2.floodFill(edges, flood_mask, (0, 0), 255)
            mask = cv2.bitwise_not(edges)

            # Clean up mask
            mask = cv2.morphologyEx(mask, cv2.MORPH_CLOSE, kernel, iterations=3)
            mask = cv2.morphologyEx(mask, cv2.MORPH_OPEN, kernel, iterations=2)

        return Image.fromarray(mask).convert("L")

    def composite_prop(
        self,
        background,
        position="center-bottom",
        scale=0.35,
        blend_mode="normal",
    ):
        """Composite the prop onto a background image.

        Args:
            background: PIL Image (the generated scene).
            position: Where to place the prop.
                Options: 'center', 'center-bottom', 'center-top',
                         'left', 'right', 'bottom-left', 'bottom-right',
                         or (x, y) tuple for custom position.
            scale: Prop size relative to background (0.0 - 1.0).
            blend_mode: 'normal', 'multiply', or 'soft-light'.

        Returns:
            Composited PIL Image.
        """
        if self.prop_image is None:
            raise ValueError("No prop loaded. Call load_prop() first.")

        bg = background.convert("RGBA")
        bg_w, bg_h = bg.size

        # Scale prop
        prop_w, prop_h = self.prop_image.size
        target_h = int(bg_h * scale)
        aspect = prop_w / prop_h
        target_w = int(target_h * aspect)
        prop_resized = self.prop_image.resize((target_w, target_h), Image.LANCZOS)
        mask_resized = self.prop_mask.resize((target_w, target_h), Image.LANCZOS)

        # Calculate position
        if isinstance(position, tuple):
            x, y = position
        else:
            positions = {
                "center": ((bg_w - target_w) // 2, (bg_h - target_h) // 2),
                "center-bottom": ((bg_w - target_w) // 2, bg_h - target_h - int(bg_h * 0.05)),
                "center-top": ((bg_w - target_w) // 2, int(bg_h * 0.05)),
                "left": (int(bg_w * 0.05), (bg_h - target_h) // 2),
                "right": (bg_w - target_w - int(bg_w * 0.05), (bg_h - target_h) // 2),
                "bottom-left": (int(bg_w * 0.08), bg_h - target_h - int(bg_h * 0.05)),
                "bottom-right": (bg_w - target_w - int(bg_w * 0.08), bg_h - target_h - int(bg_h * 0.05)),
            }
            x, y = positions.get(position, positions["center-bottom"])

        # Apply blend mode
        if blend_mode == "normal":
            bg.paste(prop_resized, (x, y), mask_resized)
        elif blend_mode == "multiply":
            # Multiply blend
            region = bg.crop((x, y, x + target_w, y + target_h))
            region_arr = np.array(region).astype(float) / 255
            prop_arr = np.array(prop_resized.convert("RGBA")).astype(float) / 255
            blended = (region_arr * prop_arr * 255).astype(np.uint8)
            blended_img = Image.fromarray(blended, "RGBA")
            bg.paste(blended_img, (x, y), mask_resized)
        elif blend_mode == "soft-light":
            region = bg.crop((x, y, x + target_w, y + target_h))
            region_arr = np.array(region).astype(float) / 255
            prop_arr = np.array(prop_resized.convert("RGBA")).astype(float) / 255
            # Soft light formula
            blended = np.where(
                prop_arr <= 0.5,
                region_arr - (1 - 2 * prop_arr) * region_arr * (1 - region_arr),
                region_arr + (2 * prop_arr - 1) * (np.sqrt(region_arr) - region_arr),
            )
            blended = (np.clip(blended, 0, 1) * 255).astype(np.uint8)
            blended_img = Image.fromarray(blended, "RGBA")
            bg.paste(blended_img, (x, y), mask_resized)

        return bg.convert("RGB")

    def add_prop_to_prompt(self, base_prompt):
        """Add prop description to a generation prompt.

        Ensures the prop is mentioned in the prompt so the AI model
        considers it during generation.
        """
        if self.prop_description:
            return f"{base_prompt}, holding {self.prop_description}, {self.prop_description} clearly visible in frame"
        return base_prompt

    def batch_composite(self, images, position="center-bottom", scale=0.35):
        """Composite prop onto multiple images.

        Args:
            images: List of PIL Images.
            position: Prop position.
            scale: Prop scale.

        Returns:
            List of composited PIL Images.
        """
        return [self.composite_prop(img, position, scale) for img in images]

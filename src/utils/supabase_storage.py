"""Supabase integration for image storage and metadata tracking.

Handles:
- Uploading images to Supabase Storage
- Tracking image metadata in the database
- Querying and retrieving images
- Managing generation job records
"""

import io
import os
import uuid
from datetime import datetime, timezone
from pathlib import Path

from PIL import Image
from supabase import create_client, Client

from src.utils.env_check import check_supabase_env, retry


class SupabaseStorage:
    """Image storage and metadata manager using Supabase."""

    BUCKET = "images"

    def __init__(self, url=None, key=None):
        url = url or os.environ.get("SUPABASE_URL")
        key = key or os.environ.get("SUPABASE_KEY")
        if not url or not key:
            check_supabase_env()  # Will raise with helpful message
        self.client: Client = create_client(url, key)

    # ── Upload ────────────────────────────────────────────────

    @retry(max_retries=3, base_delay=1.5, exceptions=(Exception,))
    def upload_image(
        self,
        image,
        filename=None,
        image_type="original",
        category=None,
        caption=None,
        tags=None,
        metadata=None,
        parent_image_id=None,
        generation_params=None,
    ):
        """Upload an image to Supabase Storage and track metadata.

        Args:
            image: PIL Image, file path, or bytes.
            filename: Filename for storage. Auto-generated if None.
            image_type: 'original', 'processed', 'generated', or 'variation'.
            category: 'product', 'face', 'landscape', or 'other'.
            caption: Image caption text.
            tags: List of tag strings.
            metadata: Additional JSONB metadata.
            parent_image_id: UUID of parent image (for variations/generated).
            generation_params: Generation parameters used (for generated images).

        Returns:
            Dict with 'id', 'storage_path', and 'public_url'.
        """
        # Convert image to bytes
        if isinstance(image, (str, Path)):
            image = Image.open(image).convert("RGB")

        if isinstance(image, Image.Image):
            buf = io.BytesIO()
            image.save(buf, format="PNG")
            image_bytes = buf.getvalue()
        elif isinstance(image, bytes):
            image_bytes = image
        else:
            raise ValueError(f"Unsupported image type: {type(image)}")

        # Generate storage path
        if filename is None:
            filename = f"{uuid.uuid4().hex}.png"
        storage_path = f"{image_type}/{filename}"

        # Upload to storage
        self.client.storage.from_(self.BUCKET).upload(
            path=storage_path,
            file=image_bytes,
            file_options={"content-type": "image/png"},
        )

        # Get public URL
        public_url = self.client.storage.from_(self.BUCKET).get_public_url(storage_path)

        # Insert metadata record
        record = {
            "filename": filename,
            "storage_path": storage_path,
            "image_type": image_type,
            "category": category,
            "caption": caption,
            "tags": tags or [],
            "metadata": metadata or {},
            "parent_image_id": parent_image_id,
            "generation_params": generation_params or {},
        }
        result = self.client.table("images").insert(record).execute()
        image_id = result.data[0]["id"]

        return {
            "id": image_id,
            "storage_path": storage_path,
            "public_url": public_url,
        }

    def upload_directory(self, directory, image_type="original", category=None):
        """Upload all images in a directory.

        Also uploads associated .txt caption files.

        Returns:
            List of upload result dicts.
        """
        directory = Path(directory)
        image_extensions = {".png", ".jpg", ".jpeg", ".webp", ".bmp"}
        results = []

        image_files = sorted(
            p for p in directory.iterdir()
            if p.suffix.lower() in image_extensions
        )

        print(f"Uploading {len(image_files)} images to Supabase...")
        for i, img_path in enumerate(image_files):
            # Check for caption file
            caption_path = img_path.with_suffix(".txt")
            caption = caption_path.read_text().strip() if caption_path.exists() else None

            result = self.upload_image(
                image=img_path,
                filename=img_path.name,
                image_type=image_type,
                category=category,
                caption=caption,
            )
            results.append(result)
            print(f"  [{i+1}/{len(image_files)}] {img_path.name} -> {result['id']}")

        print(f"Upload complete. {len(results)} images stored.")
        return results

    # ── Query ─────────────────────────────────────────────────

    def get_image(self, image_id):
        """Get image metadata by ID."""
        result = self.client.table("images").select("*").eq("id", image_id).single().execute()
        return result.data

    def list_images(self, image_type=None, category=None, limit=50):
        """List images with optional filters."""
        query = self.client.table("images").select("*").order("created_at", desc=True).limit(limit)
        if image_type:
            query = query.eq("image_type", image_type)
        if category:
            query = query.eq("category", category)
        return query.execute().data

    def get_variations(self, parent_image_id):
        """Get all variations of a specific image."""
        result = (
            self.client.table("images")
            .select("*")
            .eq("parent_image_id", parent_image_id)
            .eq("image_type", "variation")
            .order("created_at", desc=True)
            .execute()
        )
        return result.data

    def search_by_tags(self, tags, limit=50):
        """Search images by tags (any match)."""
        result = (
            self.client.table("images")
            .select("*")
            .overlaps("tags", tags)
            .limit(limit)
            .execute()
        )
        return result.data

    def get_public_url(self, storage_path):
        """Get the public URL for a stored image."""
        return self.client.storage.from_(self.BUCKET).get_public_url(storage_path)

    def download_image(self, storage_path):
        """Download an image from storage as PIL Image."""
        data = self.client.storage.from_(self.BUCKET).download(storage_path)
        return Image.open(io.BytesIO(data)).convert("RGB")

    # ── Generation Jobs ───────────────────────────────────────

    def create_job(self, prompt, reference_image_id=None, face_image_id=None, params=None):
        """Create a generation job record."""
        record = {
            "prompt": prompt,
            "reference_image_id": reference_image_id,
            "face_image_id": face_image_id,
            "params": params or {},
            "status": "pending",
        }
        result = self.client.table("generation_jobs").insert(record).execute()
        return result.data[0]

    def update_job(self, job_id, status, result_image_ids=None, error_message=None):
        """Update a generation job status."""
        update = {"status": status}
        if status == "processing":
            update["started_at"] = datetime.now(timezone.utc).isoformat()
        if status in ("completed", "failed"):
            update["completed_at"] = datetime.now(timezone.utc).isoformat()
        if result_image_ids:
            update["result_image_ids"] = result_image_ids
        if error_message:
            update["error_message"] = error_message

        result = self.client.table("generation_jobs").update(update).eq("id", job_id).execute()
        return result.data[0]

    def get_job(self, job_id):
        """Get job details."""
        return self.client.table("generation_jobs").select("*").eq("id", job_id).single().execute().data

    def list_jobs(self, status=None, limit=20):
        """List generation jobs."""
        query = self.client.table("generation_jobs").select("*").order("created_at", desc=True).limit(limit)
        if status:
            query = query.eq("status", status)
        return query.execute().data

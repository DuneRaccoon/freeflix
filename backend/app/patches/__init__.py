# Patches package initialization
from app.patches.fastapi_error_handler import apply_patches

__all__ = [
    'apply_patches',
]

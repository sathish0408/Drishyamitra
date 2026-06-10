"""
Storage utility helpers for handling Cloudinary remote URLs and local file system paths.
"""

import os
import urllib.request
import tempfile
import requests
import logging

logger = logging.getLogger(__name__)

def get_local_image_path(path_or_url):
    """
    Ensure the image is available on the local file system.
    If the input is a remote web URL, it downloads the image to a temporary local file.
    
    Parameters
    ----------
    path_or_url : str
        Local file path or remote HTTP/HTTPS URL.
        
    Returns
    -------
    tuple (str, bool)
        A tuple of (local_file_path, is_temp_file).
        If the file was downloaded, is_temp_file is True and the caller is responsible
        for deleting it from the disk when finished.
    """
    if not path_or_url:
        return None, False

    if path_or_url.startswith(('http://', 'https://')):
        try:
            # Extract file extension safely from URL
            ext = path_or_url.split('.')[-1].split('?')[0].lower()
            if ext not in ('jpg', 'jpeg', 'png', 'webp', 'bmp'):
                ext = 'jpg'
                
            # Create a temporary file and close the descriptor immediately
            fd, temp_path = tempfile.mkstemp(suffix=f".{ext}")
            os.close(fd)
            
            logger.info("Downloading remote image from: %s to temp file: %s", path_or_url, temp_path)
            r = requests.get(path_or_url, timeout=30)
            if r.status_code == 200:
                with open(temp_path, 'wb') as f:
                    f.write(r.content)
                return temp_path, True
            else:
                logger.error("Failed to download image from URL %s, status code: %d", path_or_url, r.status_code)
                # Cleanup if failed
                try:
                    os.remove(temp_path)
                except Exception:
                    pass
                return None, False
        except Exception as exc:
            logger.exception("Error during downloading remote image %s", path_or_url)
            return None, False

    # Already a local file path
    return path_or_url, False


def get_backend_url():
    """
    Get the backend base URL dynamically from the current request context,
    falling back to the BACKEND_URL environment variable or http://localhost:5000.
    """
    import os
    base_url = os.environ.get('BACKEND_URL', 'http://localhost:5000').rstrip('/')
    try:
        from flask import request, has_request_context
        if has_request_context():
            base_url = request.host_url.rstrip('/')
    except ImportError:
        pass
    return base_url


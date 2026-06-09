"""
Vector service for Drishyamitra.

Wraps ChromaDB to provide semantic search over photo descriptions and tags.
Lazily initialises a persistent ChromaDB client and collection.
"""

import logging

from flask import current_app

logger = logging.getLogger(__name__)


class VectorService:
    """Manages ChromaDB vector store for semantic photo search."""

    _client = None
    _collection = None

    @classmethod
    def _reset(cls):
        """Reset client and collection (useful for testing)."""
        cls._client = None
        cls._collection = None

    @classmethod
    def get_collection(cls):
        """
        Get or create the ChromaDB ``photos`` collection.

        Uses a persistent client whose storage directory is read from
        ``current_app.config['CHROMA_PERSIST_DIR']`` (falls back to
        ``./chroma_data``).

        Returns:
            chromadb.Collection | None: The collection object, or ``None``
            if ChromaDB is unavailable.
        """
        if cls._client is None:
            try:
                import chromadb
            except ImportError:
                logger.warning(
                    "chromadb is not installed – vector search unavailable. "
                    "Install with: pip install chromadb"
                )
                return None

            try:
                persist_dir = current_app.config.get(
                    'CHROMA_PERSIST_DIR', './chroma_data'
                )
                cls._client = chromadb.PersistentClient(path=persist_dir)
                logger.info("ChromaDB client initialised at '%s'.", persist_dir)
            except Exception as exc:
                logger.error("Failed to create ChromaDB client: %s", exc)
                return None

        if cls._collection is None:
            try:
                cls._collection = cls._client.get_or_create_collection(
                    name='photos',
                )
                logger.info("ChromaDB 'photos' collection ready.")
            except Exception as exc:
                logger.error("Failed to get/create ChromaDB collection: %s", exc)
                return None

        return cls._collection

    @classmethod
    def index_photo(cls, photo_id, description, tags):
        """
        Index a photo's text data in ChromaDB for semantic search.

        The description and tags are combined into a single document string
        and upserted with the photo's database ID as the document ID.

        Args:
            photo_id (int): Primary-key ID of the ``Photo`` record.
            description (str): AI-generated or user-supplied caption.
            tags (list[str]): List of descriptive tag strings.
        """
        collection = cls.get_collection()
        if collection is None:
            logger.warning(
                "Skipping vector indexing for photo %s – no collection.",
                photo_id,
            )
            return

        tag_str = ', '.join(tags) if tags else ''
        document = f"{description or ''} {tag_str}".strip()

        if not document:
            logger.debug("No text content to index for photo %s.", photo_id)
            return

        try:
            collection.upsert(
                ids=[str(photo_id)],
                documents=[document],
                metadatas=[{
                    'photo_id': int(photo_id),
                    'description': description or '',
                    'tags': tag_str,
                }],
            )
            logger.info("Indexed photo %s in vector store.", photo_id)
        except Exception as exc:
            logger.error(
                "Failed to index photo %s in ChromaDB: %s", photo_id, exc
            )

    @classmethod
    def search_photos(cls, query, limit=10):
        """
        Perform semantic search and return matching photo IDs.

        Args:
            query (str): Natural-language search query.
            limit (int): Maximum number of results to return (default 10).

        Returns:
            list[int]: Photo IDs sorted by descending relevance. Returns an
            empty list if the vector store is unavailable or no matches exist.
        """
        collection = cls.get_collection()
        if collection is None:
            return []

        if not query or not query.strip():
            return []

        try:
            results = collection.query(
                query_texts=[query.strip()],
                n_results=limit,
            )

            ids = results.get('ids', [[]])[0]
            distances = results.get('distances', [[]])[0] if 'distances' in results else [0.0] * len(ids)
            
            THRESHOLD = 1.15
            photo_ids = []
            for doc_id, dist in zip(ids, distances):
                if dist > THRESHOLD:
                    continue
                try:
                    photo_ids.append(int(doc_id))
                except (ValueError, TypeError):
                    logger.warning("Non-integer document ID in results: %s", doc_id)

            logger.info(
                "Vector search for '%s' returned %d result(s).",
                query,
                len(photo_ids),
            )
            return photo_ids

        except Exception as exc:
            logger.error("Vector search failed for query '%s': %s", query, exc)
            return []

    @classmethod
    def delete_photo(cls, photo_id):
        """
        Remove a photo from the vector index.

        Args:
            photo_id (int): Primary-key ID of the ``Photo`` to remove.
        """
        collection = cls.get_collection()
        if collection is None:
            return

        try:
            collection.delete(ids=[str(photo_id)])
            logger.info("Removed photo %s from vector store.", photo_id)
        except Exception as exc:
            logger.error(
                "Failed to delete photo %s from ChromaDB: %s", photo_id, exc
            )

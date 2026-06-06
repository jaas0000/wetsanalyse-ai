"""Debug wrapper om exacte error tracebacks te loggen."""

import logging

logger = logging.getLogger("debug")


def debug_serialize(obj, depth=0):
    """Recursief serialiseer een object, log elk probleem."""
    prefix = "  " * depth
    if obj is None:
        return None
    if isinstance(obj, (str, int, float, bool)):
        return obj
    if isinstance(obj, dict):
        result = {}
        for k, v in obj.items():
            try:
                result[k] = debug_serialize(v, depth + 1)
            except Exception as e:
                logger.error("%sFOUT bij key '%s': %s (type=%s)", prefix, k, e, type(v))
                raise
        return result
    if isinstance(obj, (list, tuple)):
        result = []
        for i, item in enumerate(obj):
            try:
                result.append(debug_serialize(item, depth + 1))
            except Exception as e:
                logger.error("%sFOUT bij index %d: %s (type=%s)", prefix, i, e, type(item))
                raise
        return result
    if hasattr(obj, "model_dump"):
        logger.debug("%sPydantic model %s -> model_dump(mode='json')", prefix, type(obj).__name__)
        return debug_serialize(obj.model_dump(mode="json"), depth + 1)
    # Onbekend type
    logger.error("%sONBEKEND TYPE: %s (repr=%s)", prefix, type(obj).__name__, repr(obj)[:100])
    raise TypeError(f"Object of type {type(obj).__name__} is not JSON serializable")

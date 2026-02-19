"""Environment validation and retry utilities."""

import os
import time
import functools


def check_env(required_vars, optional_vars=None):
    """Validate required environment variables are set.

    Args:
        required_vars: Dict of {VAR_NAME: "description of what it's for"}.
        optional_vars: Dict of {VAR_NAME: "description"} for non-critical vars.

    Raises:
        EnvironmentError: If any required variable is missing.
    """
    missing = []
    for var, desc in required_vars.items():
        if not os.environ.get(var):
            missing.append(f"  {var} — {desc}")

    if missing:
        msg = "Missing required environment variables:\n" + "\n".join(missing)
        msg += "\n\nSet them in your .env file or export them:\n"
        for var in required_vars:
            msg += f"  export {var}=your_value_here\n"
        raise EnvironmentError(msg)

    if optional_vars:
        for var, desc in optional_vars.items():
            if not os.environ.get(var):
                print(f"  [info] Optional: {var} not set — {desc}")


def check_gemini_env():
    """Check Gemini API environment."""
    check_env(
        required_vars={"GEMINI_API_KEY": "Google Gemini API key for image captioning/indexing"},
    )


def check_supabase_env():
    """Check Supabase environment."""
    check_env(
        required_vars={
            "SUPABASE_URL": "Supabase project URL",
            "SUPABASE_KEY": "Supabase anon/service key",
        },
    )


def check_training_env():
    """Check training environment."""
    check_env(
        required_vars={},
        optional_vars={
            "HF_TOKEN": "HuggingFace token (needed for gated models like Flux.1-dev)",
            "WANDB_API_KEY": "Weights & Biases key (for training logging)",
        },
    )


def retry(max_retries=3, base_delay=2.0, backoff_factor=2.0, exceptions=(Exception,)):
    """Decorator for retry with exponential backoff.

    Args:
        max_retries: Maximum number of retry attempts.
        base_delay: Initial delay in seconds.
        backoff_factor: Multiplier for delay between retries.
        exceptions: Tuple of exception types to catch and retry.
    """
    def decorator(func):
        @functools.wraps(func)
        def wrapper(*args, **kwargs):
            last_exception = None
            for attempt in range(max_retries + 1):
                try:
                    return func(*args, **kwargs)
                except exceptions as e:
                    last_exception = e
                    if attempt < max_retries:
                        delay = base_delay * (backoff_factor ** attempt)
                        print(f"  [retry] {func.__name__} failed ({e}), retrying in {delay:.1f}s... ({attempt + 1}/{max_retries})")
                        time.sleep(delay)
                    else:
                        print(f"  [error] {func.__name__} failed after {max_retries} retries: {e}")
            raise last_exception
        return wrapper
    return decorator

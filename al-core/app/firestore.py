"""Firestore client. With FIRESTORE_EMULATOR_HOST set it talks to the emulator and needs no credentials."""

import os
from functools import lru_cache

from google.cloud import firestore


@lru_cache
def db() -> firestore.Client:
    return firestore.Client(project=os.getenv("FIREBASE_PROJECT_ID", "demo-al"))

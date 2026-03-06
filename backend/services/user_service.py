from typing import Optional
from datetime import datetime

from core.database import get_collection
from models.user import UserSync, UserResponse


class UserService:
    COLLECTION_NAME = "users"

    @classmethod
    async def sync_user(cls, data: UserSync) -> UserResponse:
        """Create user if not exists, update name/picture if exists."""
        collection = get_collection(cls.COLLECTION_NAME)
        now = datetime.utcnow()

        existing = await collection.find_one({"google_id": data.google_id})
        if existing:
            await collection.update_one(
                {"google_id": data.google_id},
                {"$set": {"name": data.name, "picture": data.picture, "updated_at": now}},
            )
            doc = await collection.find_one({"google_id": data.google_id})
        else:
            doc = {
                "google_id": data.google_id,
                "email": data.email,
                "name": data.name,
                "picture": data.picture,
                "created_at": now,
                "updated_at": now,
            }
            result = await collection.insert_one(doc)
            doc["_id"] = result.inserted_id

        return UserResponse(
            id=str(doc["_id"]),
            google_id=doc["google_id"],
            email=doc["email"],
            name=doc["name"],
            picture=doc.get("picture"),
            created_at=doc["created_at"],
            updated_at=doc["updated_at"],
        )

    @classmethod
    async def get_by_google_id(cls, google_id: str) -> Optional[UserResponse]:
        collection = get_collection(cls.COLLECTION_NAME)
        doc = await collection.find_one({"google_id": google_id})
        if not doc:
            return None
        return UserResponse(
            id=str(doc["_id"]),
            google_id=doc["google_id"],
            email=doc["email"],
            name=doc["name"],
            picture=doc.get("picture"),
            created_at=doc["created_at"],
            updated_at=doc["updated_at"],
        )


user_service = UserService()

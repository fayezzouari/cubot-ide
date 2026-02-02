from motor.motor_asyncio import AsyncIOMotorClient
from typing import Optional

class Database:
    client: Optional[AsyncIOMotorClient] = None
    
db = Database()

async def connect_to_mongo(uri: str, db_name: str):
    """Connect to MongoDB"""
    db.client = AsyncIOMotorClient(uri)
    db.database = db.client[db_name]
    print(f"Connected to MongoDB: {db_name}")
    
async def close_mongo_connection():
    """Close MongoDB connection"""
    if db.client:
        db.client.close()
        print("MongoDB connection closed")

def get_database():
    """Get database instance"""
    return db.database

def get_collection(collection_name: str):
    """Get a collection from the database"""
    return db.database[collection_name]

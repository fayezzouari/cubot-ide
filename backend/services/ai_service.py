import json
from typing import List, Optional, AsyncGenerator
from datetime import datetime
import boto3
from botocore.config import Config as BotoConfig

from core.config import settings
from core.database import get_collection
from models.chat import (
    ChatRequest,
    ChatResponse,
    ChatMessageInDB,
    MessageRole,
    FileContext,
)
from services.file_service import file_service


class AIService:
    """Service for AI-powered code generation using AWS Bedrock"""
    
    COLLECTION_NAME = "chat_messages"
    
    def __init__(self):
        self._bedrock_client = None
        self._bedrock_runtime = None
    
    def _get_bedrock_runtime(self):
        """Get Bedrock runtime client (lazy initialization)"""
        if self._bedrock_runtime is None:
            config = BotoConfig(
                region_name=settings.AWS_REGION,
                retries={"max_attempts": 3, "mode": "standard"}
            )
            self._bedrock_runtime = boto3.client(
                "bedrock-runtime",
                config=config,
            )
        return self._bedrock_runtime
    
    async def chat(
        self,
        project_id: str,
        request: ChatRequest,
    ) -> ChatResponse:
        """
        Process a chat request and generate AI response
        
        Args:
            project_id: The project ID for context
            request: The chat request with message and optional file context
        
        Returns:
            ChatResponse with AI-generated content
        """
        try:
            # Build the prompt with file context
            system_prompt = self._build_system_prompt(request.compiler)
            user_prompt = await self._build_user_prompt(
                request.message,
                request.file_context,
            )
            
            # Get conversation history if provided
            history = request.conversation_history or []
            
            # Call Bedrock
            response_text = await self._invoke_bedrock(
                system_prompt=system_prompt,
                user_prompt=user_prompt,
                history=history,
            )
            
            # Parse response for file operations
            file_operations = self._parse_file_operations(response_text)
            
            # Save messages to database
            await self._save_message(
                project_id=project_id,
                role=MessageRole.USER,
                content=request.message,
                file_context=request.file_context,
            )
            
            await self._save_message(
                project_id=project_id,
                role=MessageRole.ASSISTANT,
                content=response_text,
                file_operations=file_operations,
            )
            
            return ChatResponse(
                message=response_text,
                file_operations=file_operations,
            )
            
        except Exception as e:
            error_message = f"Error generating response: {str(e)}"
            return ChatResponse(
                message=error_message,
                file_operations=[],
            )
    
    def _build_system_prompt(self, compiler: Optional[str] = None) -> str:
        """Build the system prompt for the AI"""
        compiler_info = ""
        if compiler:
            compiler_info = f"""
You are working with the {compiler} compiler/platform. Keep this in mind when:
- Suggesting code patterns and libraries
- Recommending pin configurations
- Writing hardware-specific code
"""
        
        return f"""You are CuBot, an expert AI assistant for embedded systems and robotics development.
You help users write code for microcontrollers including Arduino, TI ARM processors, and ESP32.

{compiler_info}

Your capabilities:
1. Write and modify code files
2. Explain code and concepts
3. Debug issues
4. Suggest optimizations
5. Help with hardware configurations

When you need to create or modify files, use this format:
```file:path/to/file.extension
<file content here>
```

For example:
```file:src/main.cpp
#include <Arduino.h>
void setup() {{
    // setup code
}}
void loop() {{
    // loop code
}}
```

Important guidelines:
- Always provide complete, working code
- Include necessary imports/includes
- Add helpful comments
- Follow best practices for embedded development
- Consider memory constraints
- Be mindful of timing and interrupts
"""
    
    async def _build_user_prompt(
        self,
        message: str,
        file_context: Optional[List[FileContext]] = None,
    ) -> str:
        """Build the user prompt with file context"""
        context_section = ""
        
        if file_context:
            context_section = "\n\n--- FILE CONTEXT ---\n"
            for fc in file_context:
                context_section += f"\n### {fc.path}\n```\n{fc.content}\n```\n"
            context_section += "\n--- END FILE CONTEXT ---\n\n"
        
        return f"{context_section}{message}"
    
    async def _invoke_bedrock(
        self,
        system_prompt: str,
        user_prompt: str,
        history: List[dict] = None,
    ) -> str:
        """Invoke Bedrock model to generate response"""
        client = self._get_bedrock_runtime()
        
        # Build messages array
        messages = []
        
        # Add history if provided
        if history:
            for msg in history[-10:]:  # Limit to last 10 messages
                messages.append({
                    "role": msg.get("role", "user"),
                    "content": msg.get("content", ""),
                })
        
        # Add current user message
        messages.append({
            "role": "user",
            "content": user_prompt,
        })
        
        # Prepare request body based on model
        # Using Converse API format for better compatibility
        request_body = {
            "anthropic_version": "bedrock-2023-05-31",
            "max_tokens": 4096,
            "system": system_prompt,
            "messages": messages,
            "temperature": 0.7,
        }
        
        try:
            response = client.invoke_model(
                modelId=settings.BEDROCK_MODEL_ID,
                body=json.dumps(request_body),
                contentType="application/json",
                accept="application/json",
            )
            
            response_body = json.loads(response["body"].read())
            
            # Extract text from response (handle different model response formats)
            if "content" in response_body:
                # Anthropic format
                content = response_body["content"]
                if isinstance(content, list) and len(content) > 0:
                    return content[0].get("text", "")
                return str(content)
            elif "completion" in response_body:
                # Legacy format
                return response_body["completion"]
            elif "generation" in response_body:
                # Amazon Titan format
                return response_body["generation"]
            else:
                return str(response_body)
                
        except Exception as e:
            raise Exception(f"Bedrock invocation failed: {str(e)}")
    
    def _parse_file_operations(self, response_text: str) -> List[dict]:
        """Parse file operations from AI response"""
        operations = []
        
        # Look for ```file:path/to/file patterns
        import re
        pattern = r"```file:([^\n]+)\n(.*?)```"
        matches = re.findall(pattern, response_text, re.DOTALL)
        
        for match in matches:
            file_path = match[0].strip()
            content = match[1].strip()
            
            operations.append({
                "operation": "create_or_update",
                "path": file_path,
                "content": content,
            })
        
        return operations
    
    async def _save_message(
        self,
        project_id: str,
        role: MessageRole,
        content: str,
        file_context: Optional[List[FileContext]] = None,
        file_operations: Optional[List[dict]] = None,
    ) -> None:
        """Save a chat message to the database"""
        collection = get_collection(self.COLLECTION_NAME)
        
        doc = {
            "project_id": project_id,
            "role": role.value,
            "content": content,
            "timestamp": datetime.utcnow(),
            "file_context": [fc.model_dump() for fc in file_context] if file_context else [],
            "file_operations": file_operations or [],
        }
        
        await collection.insert_one(doc)
    
    async def get_chat_history(
        self,
        project_id: str,
        limit: int = 50,
    ) -> List[ChatMessageInDB]:
        """Get chat history for a project"""
        collection = get_collection(self.COLLECTION_NAME)
        
        cursor = collection.find(
            {"project_id": project_id}
        ).sort("timestamp", 1).limit(limit)
        
        messages = []
        async for doc in cursor:
            messages.append(ChatMessageInDB(
                id=str(doc["_id"]),
                project_id=doc["project_id"],
                role=doc["role"],
                content=doc["content"],
                timestamp=doc["timestamp"],
                file_context=doc.get("file_context", []),
                file_operations=doc.get("file_operations", []),
            ))
        
        return messages
    
    async def apply_file_operations(
        self,
        project_id: str,
        operations: List[dict],
    ) -> List[dict]:
        """Apply file operations from AI response"""
        results = []
        
        for op in operations:
            try:
                operation_type = op.get("operation")
                file_path = op.get("path")
                content = op.get("content", "")
                
                if operation_type == "create_or_update":
                    # Check if file exists
                    existing = await file_service.get_file_by_path(
                        project_id=project_id,
                        path=file_path,
                    )
                    
                    if existing:
                        # Update existing file
                        from models.file import FileUpdate
                        await file_service.update_file(
                            file_id=existing.id,
                            file_update=FileUpdate(content=content),
                        )
                        results.append({
                            "path": file_path,
                            "operation": "updated",
                            "success": True,
                        })
                    else:
                        # Create new file
                        from models.file import FileCreate, FileType
                        
                        # Determine file type from extension
                        ext = file_path.split(".")[-1].lower() if "." in file_path else ""
                        file_type = FileType.SOURCE
                        if ext == "h" or ext == "hpp":
                            file_type = FileType.HEADER
                        elif ext in ["json", "yaml", "yml", "ini", "cfg"]:
                            file_type = FileType.CONFIG
                        
                        await file_service.create_file(FileCreate(
                            project_id=project_id,
                            name=file_path.split("/")[-1],
                            path=file_path,
                            content=content,
                            file_type=file_type,
                        ))
                        results.append({
                            "path": file_path,
                            "operation": "created",
                            "success": True,
                        })
                        
                elif operation_type == "delete":
                    existing = await file_service.get_file_by_path(
                        project_id=project_id,
                        path=file_path,
                    )
                    if existing:
                        await file_service.delete_file(existing.id)
                        results.append({
                            "path": file_path,
                            "operation": "deleted",
                            "success": True,
                        })
                    else:
                        results.append({
                            "path": file_path,
                            "operation": "delete",
                            "success": False,
                            "error": "File not found",
                        })
                        
            except Exception as e:
                results.append({
                    "path": op.get("path", "unknown"),
                    "operation": op.get("operation", "unknown"),
                    "success": False,
                    "error": str(e),
                })
        
        return results


ai_service = AIService()

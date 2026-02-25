import { useEffect, useRef, useCallback } from 'react';
import type { ArmState } from '@/lib/api/blocks';

interface UseArmStatusWebSocketProps {
  enabled: boolean;
  projectId?: string;
  onStateChange: (state: ArmState) => void;
  onError?: (error: string) => void;
}

export function useArmStatusWebSocket({
  enabled,
  projectId,
  onStateChange,
  onError,
}: UseArmStatusWebSocketProps) {
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const reconnectAttemptsRef = useRef(0);
  const maxReconnectAttempts = 5;
  const reconnectDelay = 2000; // 2 seconds

  const closeConnection = useCallback(() => {
    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
      reconnectTimeoutRef.current = null;
    }
  }, []);

  const connect = useCallback(() => {
    if (!enabled || wsRef.current) return;

    try {
      const apiBase = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000/api';
      const wsBase = apiBase.replace(/^http/, 'ws');
      const projectIdParam = projectId ? `?project_id=${projectId}` : '';
      const wsUrl = `${wsBase}/ws/arm/status${projectIdParam}`;

      const ws = new WebSocket(wsUrl);

      ws.onopen = () => {
        console.log('WebSocket connected to arm status');
        reconnectAttemptsRef.current = 0;
      };

      ws.onmessage = (event) => {
        try {
          const state = JSON.parse(event.data) as ArmState;
          onStateChange({
            position: { ...state.position },
            joints: [...state.joints],
            is_moving: state.is_moving,
          });
        } catch (error) {
          console.error('Failed to parse arm state message:', error);
        }
      };

      ws.onerror = (error) => {
        console.error('WebSocket error:', error);
        onError?.('WebSocket connection error');
        closeConnection();
      };

      ws.onclose = () => {
        console.log('WebSocket closed');
        wsRef.current = null;

        // Attempt to reconnect if enabled and max attempts not reached
        if (enabled && reconnectAttemptsRef.current < maxReconnectAttempts) {
          reconnectAttemptsRef.current += 1;
          reconnectTimeoutRef.current = setTimeout(() => {
            console.log(`Attempting to reconnect... (${reconnectAttemptsRef.current}/${maxReconnectAttempts})`);
            connect();
          }, reconnectDelay);
        }
      };

      wsRef.current = ws;
    } catch (error) {
      console.error('Failed to create WebSocket:', error);
      onError?.('Failed to connect to arm status');
    }
  }, [enabled, projectId, onStateChange, onError, closeConnection]);

  useEffect(() => {
    if (enabled) {
      connect();
    } else {
      closeConnection();
    }

    return () => {
      closeConnection();
    };
  }, [enabled, connect, closeConnection]);

  return {
    isConnected: wsRef.current?.readyState === WebSocket.OPEN,
    close: closeConnection,
  };
}

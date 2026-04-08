import { useEffect, useRef, useState, useCallback } from 'react';
import { io, Socket } from 'socket.io-client';

export function useSocket(initialLogs: any[] = []) {
  const socketRef = useRef<Socket | null>(null);
  const [connected, setConnected] = useState(false);
  const [logs, setLogs] = useState<any[]>(initialLogs);

  // Seed initial logs if provided (from API fetch)
  useEffect(() => {
    if (initialLogs.length > 0) {
      setLogs(initialLogs);
    }
  }, [initialLogs]);

  useEffect(() => {
    // Connect to WebSocket
    const socket = io('/', {
      transports: ['websocket', 'polling'],
      reconnection: true,
      reconnectionDelay: 5000, // 5 seconds between reconnect attempts
      reconnectionDelayMax: 10000, // Max 10 seconds
      reconnectionAttempts: 10, // Max 10 attempts
    });

    socket.on('connect', () => {
      setConnected(true);
    });

    socket.on('disconnect', () => {
      setConnected(false);
    });

    socket.on('log', (logEntry) => {
      setLogs(prev => {
        // Prevent duplicates — skip if log ID already exists
        if (prev.some(l => l.id === logEntry.id)) {
          return prev;
        }
        return [logEntry, ...prev].slice(0, 500); // Keep last 500 logs
      });
    });

    socketRef.current = socket;

    return () => {
      socket.disconnect();
    };
  }, []);

  const emit = useCallback((event: string, data: any) => {
    if (socketRef.current) {
      socketRef.current.emit(event, data);
    }
  }, []);

  return { socket: socketRef.current, connected, logs, emit };
}

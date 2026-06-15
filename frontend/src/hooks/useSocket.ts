import { useEffect, useState, useCallback } from 'react';
import { io, Socket } from 'socket.io-client';

export type LiveEvent = {
  id: string;
  at: string;
  name: string;
  payload: unknown;
};

function uid(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

export function useSocket() {
  const [socket, setSocket] = useState<Socket | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  const [events, setEvents] = useState<LiveEvent[]>([]);

  const pushEvent = useCallback((name: string, payload: unknown) => {
    setEvents((prev) => {
      const next = [{ id: uid(), at: new Date().toISOString(), name, payload }, ...prev];
      return next.slice(0, 50); // Keep last 50 events
    });
  }, []);

  useEffect(() => {
    const socketInstance = io('http://localhost:4000', {
      path: '/socket.io',
      transports: ['websocket', 'polling'],
    });

    socketInstance.on('connect', () => setIsConnected(true));
    socketInstance.on('disconnect', () => setIsConnected(false));

    const eventNames = ['job.started', 'job.success', 'job.failed', 'job.alert', 'dashboard.ready'];
    
    eventNames.forEach(name => {
      socketInstance.on(name, (payload: unknown) => {
        if (name !== 'dashboard.ready') {
          pushEvent(name, payload);
        }
      });
    });

    socketInstance.on('connect', () => {
      setIsConnected(true);
      setSocket(socketInstance);
    });

    return () => {
      socketInstance.disconnect();
    };
  }, [pushEvent]);

  return { isConnected, events, socket };
}

// src/websocket/WebSocketManager.ts
import { WebSocket } from 'ws';
import { v4 as uuidv4 } from 'uuid';
import { websocketLogger } from '../core/logger.js';
import { ValidationError, AuthenticationError } from '../core/errors.js';

interface Client {
  id: string;
  socket: WebSocket;
  sessionId?: string;
  userId: string;
  connectedAt: Date;
  lastActivity: Date;
}

interface WebSocketMessage {
  type: string;
  data?: any;
  sessionId?: string;
  token?: string;
  query?: string;
  icpModelId?: string;
  status?: any;
  companies?: any[];
  resultsCount?: number;
  error?: string;
  timestamp?: string;
  message?: string;
}

interface SearchStatus {
  stage: 'searching' | 'analyzing' | 'filtering' | 'complete' | 'error' | 'enriching' | 'scoring';
  message: string;
  progress: number;
  currentStep?: number;
  totalSteps?: number;
  companies?: any[];
  substeps?: any[];
}

interface SubStep {
  id: string;
  name: string;
  description?: string;
  status: 'pending' | 'in-progress' | 'completed' | 'failed' | 'error';
  category?: string;
  priority?: 'low' | 'medium' | 'high';
  tools?: string[];
  message?: string;
  progress?: number;
  startedAt?: Date;
  completedAt?: Date;
}

class WebSocketManager {
  private static instance: WebSocketManager;
  private clients: Map<string, Client> = new Map();
  private sessionClients: Map<string, Set<string>> = new Map();
  private sessionStatus: Map<string, SearchStatus> = new Map();
  private heartbeatInterval: NodeJS.Timeout;
  private instanceId: string;

  // Private constructor to enforce singleton
  private constructor() {
    this.instanceId = uuidv4();
    //console.log(`🎯 WebSocketManager instance created: ${this.instanceId}`);
    
    this.heartbeatInterval = setInterval(() => {
      this.cleanupInactiveClients();
    }, 5 * 60 * 1000);
  }

  // Singleton getInstance method
  public static getInstance(): WebSocketManager {
    if (!WebSocketManager.instance) {
      WebSocketManager.instance = new WebSocketManager();
    }
    return WebSocketManager.instance;
  }

  addClient(socket: WebSocket, userId: string): string {
    const clientId = uuidv4();
    const now = new Date();
    
    const client: Client = { 
      id: clientId, 
      socket, 
      userId,
      connectedAt: now,
      lastActivity: now
    };
    
    this.clients.set(clientId, client);
    
    //console.log(`✅ Client ${clientId} added. Total clients: ${this.clients.size}`);
    //console.log(`📊 Current sessions:`, Array.from(this.sessionClients.entries()));
    
    socket.on('close', (code, reason) => {
      const reasonString = reason?.toString() || 'No reason provided';
      //console.log(`🔌 WebSocket disconnected: ${clientId} (code: ${code})`);
      websocketLogger.info({ clientId, code, reason: reasonString }, 'WebSocket client disconnected');
      this.removeClient(clientId);
    });
    
    socket.on('error', (error) => {
      console.error(`❌ WebSocket error for ${clientId}:`, error);
      websocketLogger.error({ clientId, error: error.message }, 'WebSocket client error');
      this.removeClient(clientId);
    });
    
    socket.on('pong', () => {
      this.updateClientActivity(clientId);
    });

    this.setupHeartbeat(socket);

    return clientId;
  }
  public logStepStatus(stepId: string, status: string, message: string) {
    //console.log(`📝 Step ${stepId}: ${status} - ${message}`);
  }
  private setupHeartbeat(socket: WebSocket) {
    const interval = setInterval(() => {
      if (socket.readyState === WebSocket.OPEN) {
        socket.ping();
      } else {
        clearInterval(interval);
      }
    }, 30000);

    socket.on('close', () => clearInterval(interval));
  }

  private updateClientActivity(clientId: string) {
    const client = this.clients.get(clientId);
    if (client) {
      client.lastActivity = new Date();
    }
  }

  private cleanupInactiveClients() {
    const now = new Date();
    const inactiveThreshold = 10 * 60 * 1000;

    for (const [clientId, client] of this.clients.entries()) {
      if (now.getTime() - client.lastActivity.getTime() > inactiveThreshold) {
        //console.log(`🕒 Removing inactive client: ${clientId}`);
        websocketLogger.info({ clientId }, 'Removing inactive client');
        client.socket.close(1000, 'Inactive timeout');
        this.removeClient(clientId);
      }
    }
  }

  removeClient(clientId: string) {
    const client = this.clients.get(clientId);
    if (client?.sessionId) {
      this.leaveSession(clientId, client.sessionId);
    }
    this.clients.delete(clientId);
    //console.log(`🗑️ Client ${clientId} removed. Total clients: ${this.clients.size}`);
  }

  async handleMessage(clientId: string, message: WebSocketMessage) {
    try {
      this.updateClientActivity(clientId);

      if (!message.type) {
        throw new ValidationError('Message type is required');
      }

      //console.log(`📨 Handling message type: ${message.type} for client: ${clientId}`);

      switch (message.type) {
        case 'join-session':
          await this.handleJoinSession(clientId, message);
          break;
        
        case 'leave-session':
          await this.handleLeaveSession(clientId, message);
          break;
        
        case 'start-search':
          await this.handleStartSearch(clientId, message);
          break;
        
        case 'get-search-status':
          await this.handleGetSearchStatus(clientId, message);
          break;
        
        case 'ping':
          this.sendToClient(clientId, { type: 'pong', timestamp: new Date().toISOString() });
          break;
        
        default:
          console.warn(`❌ Unknown message type: ${message.type}`);
          websocketLogger.warn({ clientId, type: message.type }, 'Unknown message type');
          this.sendToClient(clientId, { 
            type: 'error', 
            error: `Unknown message type: ${message.type}` 
          });
      }
    } catch (error) {
      console.error(`❌ Error handling message for client ${clientId}:`, error);
      websocketLogger.error({ clientId, error: error }, 'Error handling WebSocket message');
      this.sendToClient(clientId, { 
        type: 'error', 
        error: error 
      });
    }
  }

  private async handleJoinSession(clientId: string, message: WebSocketMessage) {
    if (!message.sessionId) {
      throw new ValidationError('sessionId is required for join-session');
    }

    await this.validateSessionAccess(clientId, message.sessionId, message.token);

    this.joinSession(clientId, message.sessionId);
    
    //console.log(`✅ Client ${clientId} joined session ${message.sessionId}`);
    websocketLogger.info({ clientId, sessionId: message.sessionId }, 'Client joined session');
    
    this.sendToClient(clientId, {
      type: 'session-joined',
      sessionId: message.sessionId,
      timestamp: new Date().toISOString()
    });

    // Send connected message
    this.sendToClient(clientId, {
      type: 'connected',
      sessionId: message.sessionId,
      message: 'WebSocket connected successfully'
    });
  }

  private async handleLeaveSession(clientId: string, message: WebSocketMessage) {
    const client = this.clients.get(clientId);
    if (client?.sessionId) {
      this.leaveSession(clientId, client.sessionId);
      //console.log(`🚪 Client ${clientId} left session ${client.sessionId}`);
      websocketLogger.info({ clientId, sessionId: client.sessionId }, 'Client left session');
    }
  }

  private async handleStartSearch(clientId: string, message: WebSocketMessage) {
    if (!message.sessionId) {
      throw new ValidationError('sessionId is required for start-search');
    }
    if (!message.query) {
      throw new ValidationError('query is required for start-search');
    }

    const { sessionId, query, icpModelId } = message;
    const client = this.clients.get(clientId);

    //console.log(`🚀 Starting search for session: ${sessionId}`, { query, icpModelId });

    const initialStatus: SearchStatus = {
      stage: 'searching',
      message: 'Starting intelligent search...',
      progress: 10,
      currentStep: 1,
      totalSteps: 4,
      substeps: []
    };

    this.sessionStatus.set(sessionId, initialStatus);

    this.broadcastToSession(sessionId, {
      type: 'workflow-status',
      sessionId,
      data: initialStatus
    });

    this.sendToClient(clientId, {
      type: 'search-started',
      sessionId,
      timestamp: new Date().toISOString()
    });
  }
  public broadcastToUser(userId: string, message: any) {
    let sentCount = 0;
    const messageStr = JSON.stringify(message);
    
    for (const [clientId, client] of this.clients.entries()) {
      if (client.userId === userId && client.socket.readyState === WebSocket.OPEN) {
        try {
          client.socket.send(messageStr);
          sentCount++;
          //console.log(`✅ Sent ${message.type} to user ${userId} client: ${clientId}`);
        } catch (error) {
          console.error(`❌ Failed to send to user client ${clientId}:`, error);
        }
      }
    }
    
    //console.log(`📤 User broadcast completed: sent to ${sentCount} clients for user ${userId}`);
  }
  private async handleGetSearchStatus(clientId: string, message: WebSocketMessage) {
    if (!message.sessionId) {
      throw new ValidationError('sessionId is required for get-search-status');
    }

    const status = this.sessionStatus.get(message.sessionId) || {
      stage: 'unknown' as const,
      message: 'No search in progress',
      progress: 0,
      substeps: []
    };

    this.sendToClient(clientId, {
      type: 'search-status',
      sessionId: message.sessionId,
      status
    });
  }

  private calculateCurrentStep(progress: number): number {
    if (progress <= 25) return 1;
    if (progress <= 50) return 2;
    if (progress <= 75) return 3;
    return 4;
  }

  private async validateSessionAccess(clientId: string, sessionId: string, token?: string) {
    if (!token && process.env.NODE_ENV === 'production') {
      throw new AuthenticationError('Authentication token required');
    }

    if (sessionId.includes('..') || sessionId.length > 100) {
      throw new ValidationError('Invalid session ID');
    }

    return true;
  }

  joinSession(clientId: string, sessionId: string) {
    const client = this.clients.get(clientId);
    if (client) {
      if (client.sessionId && client.sessionId !== sessionId) {
        this.leaveSession(clientId, client.sessionId);
      }

      client.sessionId = sessionId;
      
      if (!this.sessionClients.has(sessionId)) {
        this.sessionClients.set(sessionId, new Set());
      }
      this.sessionClients.get(sessionId)!.add(clientId);    
   
      //console.log(`✅ Client ${clientId} joined session ${sessionId}`);
      //console.log(`📊 Session clients:`, Array.from(this.sessionClients.get(sessionId) || []));
      websocketLogger.debug({ clientId, sessionId }, 'Client joined session');
    }
  }

  leaveSession(clientId: string, sessionId: string) {
    this.sessionClients.get(sessionId)?.delete(clientId);
    
    const client = this.clients.get(clientId);
    if (client) {
      client.sessionId = undefined;
    }

    //console.log(`🚪 Client ${clientId} left session ${sessionId}`);
    websocketLogger.debug({ clientId, sessionId }, 'Client left session');
  }

  broadcastToSession(sessionId: string, message: any) {
    const clients = this.sessionClients.get(sessionId);
    //console.log(`📊 Instance ${this.instanceId} - Broadcasting to session ${sessionId}:`, message.type);
    //console.log(`👥 Clients in session ${sessionId}:`, Array.from(clients || []));
    
    if (!clients || clients.size === 0) {
      //console.log(`❌ No clients to broadcast for session: ${sessionId}`);
      return;
    }

    const messageStr = JSON.stringify(message);
    let sentCount = 0;
    
    const clientsToCheck = Array.from(clients);
    
    for (const clientId of clientsToCheck) {
      const client = this.clients.get(clientId);
      
      if (!client) {
        //console.log(`❌ Client ${clientId} not found, removing from session`);
        clients.delete(clientId);
        continue;
      }
      
      const readyState = client.socket?.readyState;
      
      if (readyState === WebSocket.OPEN) {
        try {
          //console.log(`✅ Sending ${message.type} to client: ${clientId}`);
          client.socket.send(messageStr);
          sentCount++;
        } catch (error) {
          console.error(`❌ Failed to send to client ${clientId}:`, error);
          clients.delete(clientId);
          this.clients.delete(clientId);
        }
      } else {
        //console.log(`❌ Client ${clientId} not ready. State: ${this.getReadyStateText(readyState)}`);
        if (readyState === WebSocket.CLOSED) {
          clients.delete(clientId);
          this.clients.delete(clientId);
        }
      }
    }

    //console.log(`📤 Broadcast completed for session ${sessionId}: sent to ${sentCount}/${clientsToCheck.length} clients`);
    websocketLogger.debug({ sessionId, sentCount, totalClients: clientsToCheck.length, messageType: message.type }, 'Broadcast completed');
  }

  private getReadyStateText(readyState: number | undefined): string {
    switch (readyState) {
      case WebSocket.CONNECTING: return 'CONNECTING';
      case WebSocket.OPEN: return 'OPEN';
      case WebSocket.CLOSING: return 'CLOSING';
      case WebSocket.CLOSED: return 'CLOSED';
      default: return 'UNKNOWN';
    }
  }

  sendToClient(clientId: string, message: any) {
    const client = this.clients.get(clientId);
    if (client?.socket.readyState === WebSocket.OPEN) {
      try {
        client.socket.send(JSON.stringify(message));
        //console.log(`✅ Sent ${message.type} to client: ${clientId}`);
      } catch (error) {
        console.error(`❌ Failed to send message to client ${clientId}:`, error);
        websocketLogger.error({ clientId, error: error }, 'Failed to send message to client');
      }
    }
  }

  getClientCount(): number {
    return this.clients.size;
  }

  getSessionCount(): number {
    return this.sessionClients.size;
  }

  destroy() {
    //console.log(`🛑 Destroying WebSocketManager instance: ${this.instanceId}`);
    clearInterval(this.heartbeatInterval);
    
    for (const client of this.clients.values()) {
      client.socket.close(1001, 'Server shutdown');
    }
    
    this.clients.clear();
    this.sessionClients.clear();
    this.sessionStatus.clear();
  }

  // Debug method
  public debugInstance() {
    return {
      instanceId: this.instanceId,
      totalClients: this.clients.size,
      totalSessions: this.sessionClients.size,
      sessions: Array.from(this.sessionClients.entries()).map(([sessionId, clients]) => ({
        sessionId,
        clientCount: clients.size,
        clients: Array.from(clients)
      }))
    };
  }
}

// Export singleton instance
export const wsManager = WebSocketManager.getInstance();
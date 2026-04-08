import fs from 'fs';
import path from 'path';
import { readJsonFile, writeJsonFile } from './json-store';

// Use same project root resolution as json-store.ts
const PROJECT_ROOT = path.resolve(__dirname, '../../');
const DATA_DIR = path.join(PROJECT_ROOT, 'src', 'storage', 'data');
const SESSION_FILE = path.join(DATA_DIR, 'session.json');

// Ensure data directory exists
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

interface TelegramSession {
  sessionString: string;
  phoneNumber: string;
  createdAt: string;
  lastValidated: string;
}

const DEFAULT_SESSION: TelegramSession = {
  sessionString: '',
  phoneNumber: '',
  createdAt: new Date().toISOString(),
  lastValidated: new Date().toISOString()
};

/**
 * Load Telegram session from dedicated session file
 */
export async function getSession(): Promise<TelegramSession | null> {
  try {
    const session = await readJsonFile<TelegramSession>(SESSION_FILE);
    
    // Validate session has required fields
    if (!session || !session.sessionString || !session.phoneNumber) {
      return null;
    }
    
    return session;
  } catch (error) {
    // Session file doesn't exist or is invalid
    return null;
  }
}

/**
 * Save Telegram session to dedicated session file
 */
export async function saveSession(session: Partial<TelegramSession>): Promise<void> {
  try {
    // Get existing session or create new
    const existing = await getSession() || { ...DEFAULT_SESSION };
    
    // Merge updates
    const updated = {
      ...existing,
      ...session,
      lastValidated: new Date().toISOString()
    };
    
    await writeJsonFile(SESSION_FILE, updated);
    console.log('[Session] Session saved successfully');
  } catch (error: any) {
    console.error('[Session] Failed to save session:', error.message);
    throw error;
  }
}

/**
 * Clear Telegram session file
 */
export async function clearSession(): Promise<void> {
  try {
    await writeJsonFile(SESSION_FILE, {
      sessionString: '',
      phoneNumber: '',
      createdAt: new Date().toISOString(),
      lastValidated: new Date().toISOString()
    });
    console.log('[Session] Session cleared');
  } catch (error: any) {
    console.error('[Session] Failed to clear session:', error.message);
    throw error;
  }
}

/**
 * Check if a valid session exists
 */
export async function hasValidSession(): Promise<boolean> {
  const session = await getSession();
  return session !== null && session.sessionString.length > 0;
}

/**
 * Migrate session from config to dedicated file
 * Called once on startup to move existing session string
 */
export async function migrateSessionFromConfig(configSessionString?: string, configPhoneNumber?: string): Promise<boolean> {
  if (!configSessionString || configSessionString.length === 0) {
    return false;
  }
  
  // Check if session file already exists
  const existingSession = await getSession();
  if (existingSession) {
    return false; // Already migrated
  }
  
  // Migrate to session file
  await saveSession({
    sessionString: configSessionString,
    phoneNumber: configPhoneNumber || ''
  });
  
  console.log('[Session] Migrated session from config to session file');
  return true;
}

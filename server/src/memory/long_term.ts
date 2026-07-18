import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import type { Preference, SavedPlace, SessionSummary } from '../types';

export interface LongTermMemory {
  getPreference(key: string): Promise<string | undefined>;
  getAllPreferences(): Promise<Record<string, string>>;
  setPreference(key: string, value: string): Promise<void>;
  savePlace(place: SavedPlace): Promise<void>;
  getPlaces(): Promise<SavedPlace[]>;
  saveSummary(sessionId: string, summary: string, messageCount: number): Promise<void>;
  getRecentSummaries(limit: number): Promise<SessionSummary[]>;
}

export function createLongTermMemory(opts: { dbPath: string }): LongTermMemory {
  // 文件型库：确保目录存在（:memory: 跳过）
  if (opts.dbPath !== ':memory:') {
    fs.mkdirSync(path.dirname(opts.dbPath), { recursive: true });
  }
  const db = new DatabaseSync(opts.dbPath);
  db.exec(`
    CREATE TABLE IF NOT EXISTS preferences (key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS saved_places (id TEXT PRIMARY KEY, name TEXT NOT NULL, lng REAL NOT NULL, lat REAL NOT NULL, address TEXT, tags TEXT, saved_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS session_summaries (session_id TEXT PRIMARY KEY, summary TEXT NOT NULL, message_count INTEGER NOT NULL, updated_at TEXT NOT NULL);
  `);

  const now = () => new Date().toISOString();

  const stmtGetPref = db.prepare('SELECT value FROM preferences WHERE key = ?');
  const stmtAllPref = db.prepare('SELECT key, value FROM preferences');
  const stmtSetPref = db.prepare('INSERT OR REPLACE INTO preferences (key, value, updated_at) VALUES (?, ?, ?)');
  const stmtSavePlace = db.prepare('INSERT OR REPLACE INTO saved_places (id, name, lng, lat, address, tags, saved_at) VALUES (?, ?, ?, ?, ?, ?, ?)');
  const stmtGetPlaces = db.prepare('SELECT id, name, lng, lat, address, tags, saved_at FROM saved_places ORDER BY saved_at DESC');
  const stmtSaveSummary = db.prepare('INSERT OR REPLACE INTO session_summaries (session_id, summary, message_count, updated_at) VALUES (?, ?, ?, ?)');
  const stmtRecentSummaries = db.prepare('SELECT session_id, summary, message_count, updated_at FROM session_summaries ORDER BY updated_at DESC LIMIT ?');

  return {
    async getPreference(key) {
      const row = stmtGetPref.get(key) as { value: string } | undefined;
      return row?.value;
    },
    async getAllPreferences() {
      const rows = stmtAllPref.all() as Array<{ key: string; value: string }>;
      const out: Record<string, string> = {};
      for (const r of rows) out[r.key] = r.value;
      return out;
    },
    async setPreference(key, value) {
      stmtSetPref.run(key, value, now());
    },
    async savePlace(place) {
      stmtSavePlace.run(
        place.id, place.name, place.location.lng, place.location.lat,
        place.address ?? null, place.tags ? JSON.stringify(place.tags) : null, place.savedAt,
      );
    },
    async getPlaces() {
      const rows = stmtGetPlaces.all() as Array<{
        id: string; name: string; lng: number; lat: number;
        address: string | null; tags: string | null; saved_at: string;
      }>;
      return rows.map((r): SavedPlace => ({
        id: r.id, name: r.name, location: { lng: r.lng, lat: r.lat },
        address: r.address ?? undefined, tags: r.tags ? JSON.parse(r.tags) : undefined, savedAt: r.saved_at,
      }));
    },
    async saveSummary(sessionId, summary, messageCount) {
      stmtSaveSummary.run(sessionId, summary, messageCount, now());
    },
    async getRecentSummaries(limit) {
      const rows = stmtRecentSummaries.all(limit) as Array<{
        session_id: string; summary: string; message_count: number; updated_at: string;
      }>;
      return rows.map((r): SessionSummary => ({
        sessionId: r.session_id, summary: r.summary,
        messageCount: r.message_count, updatedAt: r.updated_at,
      }));
    },
  };
}

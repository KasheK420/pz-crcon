export interface PlayerRow {
  id: string;
  steamId: string;
  name: string;
  isOnline: boolean;
  isBanned: boolean;
  banReason: string | null;
  lastSeen: string;
  firstSeen: string;
  deaths: number;
  totalPlaytime: number;
  isWhitelisted: boolean;
  countryLast: string | null;
  lastRegion: string | null;
  notes: string | null;
}

export interface PlayersResponse {
  serverOnline: boolean;
  onlineCount: number;
  players: PlayerRow[];
}

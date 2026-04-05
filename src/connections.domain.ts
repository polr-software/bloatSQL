export enum DatabaseType {
  MariaDB = 'mariadb',
  PostgreSQL = 'postgresql',
}

export interface Connection {
  id: string;
  name: string;
  dbType: DatabaseType;
  host: string;
  port: number;
  username: string;
  password: string;
  database: string;
  sslMode: 'disabled' | 'preferred' | 'required';
}

export interface ConnectionFormData {
  name: string;
  dbType: DatabaseType;
  host: string;
  port: number;
  username: string;
  password: string;
  database: string;
  sslMode: 'disabled' | 'preferred' | 'required';
}

export type ConnectionDraft = Omit<Connection, 'id'> & { id?: string };

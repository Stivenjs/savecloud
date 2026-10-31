/** Opciones compartidas para configurar el pool SQL de la aplicación. */
export interface DatabaseConnectionOptions {
  /** URL PostgreSQL completa; tiene prioridad sobre los campos de conexión individuales. */
  connectionString?: string;
  /** Nombre DNS o dirección IP del servidor PostgreSQL. */
  hostname?: string;
  /** Puerto TCP del servidor PostgreSQL. */
  port?: number;
  /** Usuario PostgreSQL del servicio. */
  username?: string;
  /** Contraseña PostgreSQL del servicio. */
  password?: string;
  /** Base de datos PostgreSQL seleccionada para el servicio. */
  database?: string;
  /** Número máximo de conexiones que mantendrá el pool. */
  poolSize: number;
}

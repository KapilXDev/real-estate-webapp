import { Global, Module } from "@nestjs/common";

import { APP_CONFIG, loadConfig } from "../config/configuration";
import { DatabaseService } from "./database.service";

/**
 * Global so every feature module can inject DatabaseService without re-importing.
 *
 * The config provider lives here rather than in a separate module because a database connection
 * is the first thing that needs it, and validation must happen before anything opens a socket.
 */
@Global()
@Module({
  providers: [
    {
      provide: APP_CONFIG,
      useFactory: () => loadConfig(),
    },
    DatabaseService,
  ],
  exports: [APP_CONFIG, DatabaseService],
})
export class DatabaseModule {}

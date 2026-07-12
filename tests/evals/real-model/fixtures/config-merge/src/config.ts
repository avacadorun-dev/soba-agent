export interface AppConfig {
  server: {
    host: string;
    port: number;
  };
  logging: {
    level: "debug" | "info" | "warn" | "error";
    json: boolean;
  };
}

export type ConfigOverrides = {
  server?: Partial<AppConfig["server"]>;
  logging?: Partial<AppConfig["logging"]>;
};

export function mergeConfig(defaults: AppConfig, overrides: ConfigOverrides): AppConfig {
  return { ...defaults, ...overrides } as AppConfig;
}

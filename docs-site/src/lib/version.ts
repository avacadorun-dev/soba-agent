import packageJson from "../../../package.json";

export const APP_VERSION = packageJson.version;
export const APP_VERSION_LABEL = `v${APP_VERSION}`;
export const APP_MINOR_VERSION = `v${APP_VERSION.split(".").slice(0, 2).join(".")}` as `v${number}.${number}`;

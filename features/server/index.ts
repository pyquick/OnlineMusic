/**
 * The server settings card: where the studio's API lives.
 *
 * The address itself is read and written through infrastructure/api/base (the one place the API
 * layer and this card share), so this feature is only the view.
 */
export { default as ServerSettings } from "./ServerSettings";

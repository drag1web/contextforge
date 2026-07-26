const { normalizeWebsiteOrigin } = require("./desktop-sync.cjs");

const DESKTOP_PROTOCOL = "contextforge";
const DESKTOP_CONNECT_HOST = "connect";

function normalizeLaunchToken(rawValue) {
  const value = String(rawValue ?? "").trim();

  if (!/^cfl_[a-f0-9]{64}$/.test(value)) {
    throw Object.assign(new Error("The one-click pairing token is invalid."), {
      code: "PAIRING_LAUNCH_TOKEN_INVALID"
    });
  }

  return value;
}

function parseDesktopConnectUrl(
  rawValue,
  { allowInsecureLocal = false, allowedOrigins = [] } = {}
) {
  const value = String(rawValue ?? "").trim();

  if (!value || value.length > 2_048) {
    throw Object.assign(new Error("The ContextForge link is invalid."), {
      code: "DESKTOP_LINK_INVALID"
    });
  }

  let url;

  try {
    url = new URL(value);
  } catch {
    throw Object.assign(new Error("The ContextForge link is invalid."), {
      code: "DESKTOP_LINK_INVALID"
    });
  }

  if (
    url.protocol !== `${DESKTOP_PROTOCOL}:` ||
    url.hostname !== DESKTOP_CONNECT_HOST ||
    (url.pathname !== "" && url.pathname !== "/") ||
    url.username ||
    url.password
  ) {
    throw Object.assign(new Error("The ContextForge link action is not supported."), {
      code: "DESKTOP_LINK_UNSUPPORTED"
    });
  }

  const launchToken = normalizeLaunchToken(url.searchParams.get("token"));
  const siteUrl = normalizeWebsiteOrigin(url.searchParams.get("origin"), {
    allowInsecureLocal
  });
  const unexpectedParameter = [...url.searchParams.keys()].find(
    (key) => key !== "token" && key !== "origin"
  );

  if (unexpectedParameter) {
    throw Object.assign(new Error("The ContextForge link contains unsupported data."), {
      code: "DESKTOP_LINK_UNSUPPORTED"
    });
  }

  if (allowedOrigins.length > 0 && !allowedOrigins.includes(siteUrl)) {
    throw Object.assign(new Error("The ContextForge link origin is not trusted."), {
      code: "DESKTOP_LINK_ORIGIN_UNTRUSTED"
    });
  }

  return { launchToken, siteUrl };
}

function findDesktopConnectUrl(argv = []) {
  return argv.find(
    (value) => typeof value === "string" && value.toLowerCase().startsWith(`${DESKTOP_PROTOCOL}://`)
  ) ?? null;
}

module.exports = {
  DESKTOP_PROTOCOL,
  findDesktopConnectUrl,
  normalizeLaunchToken,
  parseDesktopConnectUrl
};

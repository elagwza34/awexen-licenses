-- Additive metadata only. Apply to a reviewed disposable/staging DB first.
CREATE TABLE pms_installations (
  license_id INTEGER PRIMARY KEY REFERENCES licenses(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  installation_id UUID NOT NULL UNIQUE,
  server_fingerprint VARCHAR(128) NOT NULL
);
CREATE TABLE pms_device_keys (
  device_id INTEGER PRIMARY KEY REFERENCES devices(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  installation_id UUID NOT NULL REFERENCES pms_installations(installation_id) ON DELETE RESTRICT ON UPDATE CASCADE,
  public_key_hash VARCHAR(64) NOT NULL
);

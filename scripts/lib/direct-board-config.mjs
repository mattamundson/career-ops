function slugifyLocation(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function normalizeLocationVariant(scan, variant, index) {
  if (typeof variant === 'string') {
    return {
      location: variant,
      enabled: scan.enabled !== false,
      nameSuffix: slugifyLocation(variant) || `location-${index + 1}`,
    };
  }

  const value = variant?.value ?? variant?.location ?? '';
  return {
    location: value,
    enabled: variant?.enabled ?? scan.enabled ?? true,
    nameSuffix: variant?.name_suffix ?? variant?.nameSuffix ?? (slugifyLocation(value) || `location-${index + 1}`),
  };
}

export function expandDirectJobBoardScans(scans = []) {
  return scans.flatMap((scan) => {
    const baseName = scan.name;

    if (Array.isArray(scan.locations) && scan.locations.length > 0) {
      return scan.locations.map((variant, index) => {
        const normalized = normalizeLocationVariant(scan, variant, index);
        return {
          ...scan,
          baseName,
          name: `${baseName}-${normalized.nameSuffix}`,
          location: normalized.location || null,
          enabled: normalized.enabled,
        };
      });
    }

    return [{
      ...scan,
      baseName,
      location: scan.location ?? null,
    }];
  });
}

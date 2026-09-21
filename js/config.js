// Public config. The CARTO key here is intentionally in the clear: it is
// domain-restricted by CARTO to opoo-em.github.io (confirmed 2026-09-21),
// so lifting it from this public repo does not let anyone use it elsewhere.
// See build spec Section 2.4 and Section 15 rule #9.

export const CONFIG = {
  CARTO_KEY: 'cb1_3sla_1_ccd4a889ef721b672df1e898',
  OWNER: 'opoo-em',
  PUBLIC_REPO: 'property-tool',
  PRIVATE_REPO: 'property-tool-private',
  DEFAULT_BRANCH: 'main',
};

export const LS_KEYS = {
  PAT: 'pt.pat',
  UI_SELECTED: 'pt.ui.selected',
  UI_FILTER: 'pt.ui.filter',
  UI_SORT: 'pt.ui.sort',
  UI_REJECTED_COLLAPSED: 'pt.ui.rejected_collapsed',
};

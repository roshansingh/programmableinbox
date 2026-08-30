import type { SidebarsConfig } from '@docusaurus/plugin-content-docs';
// eslint-disable-next-line @typescript-eslint/no-var-requires
const apiSidebar = require('./docs/api-reference/sidebar.ts');

const sidebars: SidebarsConfig = {
  docsSidebar: [
    {
      type: 'category',
      label: 'Introduction',
      items: [
        'introduction/overview',
        'introduction/core-concepts',
        'introduction/quickstart-docker',
      ],
    },
    {
      type: 'category',
      label: 'Self-Hosting',
      items: [
        'self-hosting/requirements-and-installation',
        'self-hosting/configuration',
        'self-hosting/production-deployment',
        'self-hosting/upgrading',
      ],
    },
    {
      type: 'category',
      label: 'API Reference',
      items: [
        'api-reference/authentication-and-scopes',
        ...apiSidebar,
      ],
    },
  ],
};

export default sidebars;

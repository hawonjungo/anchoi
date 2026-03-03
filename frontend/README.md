# AnChoi Frontend

A modern React application for collaborative spot planning and discovery with real-time geospatial visualization.

## Overview

AnChoi is a location-based planning platform that enables users to discover, save, and collaborate on interesting spots. The frontend provides an intuitive interface with integrated Google Maps visualization, user authentication via AWS Cognito, and seamless API integration with the backend infrastructure.

## Architecture

### Technology Stack

- **Framework**: React 19.2.0
- **Build Tool**: Vite 7.3.1 (Fast HMR and optimized production builds)
- **Styling**: Tailwind CSS 3.4.19 with PostCSS
- **Maps**: Google Maps API (@react-google-maps/api)
- **Authentication**: AWS Cognito with PKCE flow
- **Backend Integration**: AWS Amplify (auth) + AWS API Gateway
- **Code Quality**: ESLint 9.39.1

### Project Structure

```
src/
├── App.jsx              # Main application component with map integration
├── App.css              # Application styles
├── index.css            # Global styles
├── main.jsx             # React entry point
├── lib/
│   └── apiClient.js     # Authenticated API client utility
└── assets/              # Static assets (images, logos)
```

### Application Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    React Application (Vite)                  │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  ┌──────────────────┐      ┌──────────────────┐             │
│  │   App Component  │      │  Google Maps API │             │
│  │  - Auth Logic    │      │  - Visualization │             │
│  │  - State Mgmt    │───→  │  - Markers       │             │
│  │  - API Calls     │      │  - InfoWindows   │             │
│  └────────┬─────────┘      └──────────────────┘             │
│           │                                                  │
│           ▼                                                  │
│  ┌──────────────────────────────────────┐                   │
│  │     AWS Cognito Authentication       │                   │
│  │  - Hosted UI (PKCE Authorization)    │                   │
│  │  - Token Storage & Management        │                   │
│  └────────┬─────────────────────────────┘                   │
│           │                                                  │
│           ▼                                                  │
│  ┌──────────────────────────────────────────────────┐       │
│  │       AWS API Gateway + Backend Services         │       │
│  │  - /spots    (List, Get, Create)                 │       │
│  │  - /plans    (Collaborative planning)            │       │
│  │  - Region: ap-southeast-2 (Sydney)               │       │
│  └──────────────────────────────────────────────────┘       │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

### Authentication Flow

The application uses AWS Cognito with the Authorization Code + PKCE flow for secure, token-based authentication:

1. User clicks "Login" → Redirected to Cognito Hosted UI
2. User authenticates → Authorization code returned to `/auth/callback`
3. Authorization code exchanged for access & refresh tokens
4. Tokens stored in localStorage with expiration handling
5. Access token included in all API requests via `apiFetch` utility
6. Automatic logout redirects to home page

### API Integration

The `apiClient.js` utility provides authenticated HTTP requests:

```javascript
import { apiFetch } from "./lib/apiClient";

// Automatically includes Authorization header with access token
const response = await apiFetch("/spots", {
  method: "GET",
});
```

All API calls are routed through the local development proxy (`/api/*`) which forwards to AWS API Gateway.

## Features

### Core Features

- **Interactive Map Visualization**: Real-time display of spots using Google Maps API with custom markers and info windows
- **User Authentication**: Secure OAuth 2.0 authentication via AWS Cognito
- **Spot Discovery**: Browse and view details of discovered locations
- **Saved Plans**: Cache and manage personal spot collections
- **Responsive Design**: Mobile-friendly interface built with Tailwind CSS
- **Real-time Updates**: Fast Refresh development experience with Vite HMR

### User Experience

- Clean, modern UI with intuitive navigation
- Persistent authentication with automatic token refresh
- Local caching of user preferences and saved plans
- Seamless map interactions with marker clustering and zoom controls

## Setup Instructions

### Prerequisites

- Node.js 16.x or higher
- npm or yarn package manager
- AWS Account with Cognito and API Gateway configured
- Google Maps API key

### Environment Variables

Create a `.env` or `.env.local` file in the project root with the following variables:

```env
# Google Maps API
VITE_GOOGLE_MAPS_API_KEY=your_google_maps_api_key

# AWS Cognito Configuration
VITE_COGNITO_DOMAIN=https://your-cognito-domain.auth.ap-southeast-2.amazoncognito.com
VITE_COGNITO_CLIENT_ID=your_cognito_client_id
VITE_COGNITO_REDIRECT_URI=http://localhost:5173/auth/callback
VITE_COGNITO_LOGOUT_REDIRECT_URI=http://localhost:5173/

# API Configuration
VITE_API_BASE_URL=https://your-api-id.execute-api.ap-southeast-2.amazonaws.com/stage
```

### Installation

1. **Clone the repository**
   ```bash
   git clone <repository-url>
   cd frontend
   ```

2. **Install dependencies**
   ```bash
   npm install
   ```

3. **Configure environment variables**
   - Copy the settings from the "Environment Variables" section above
   - Update with your actual AWS Cognito and API Gateway endpoints
   - Add your Google Maps API key

4. **Start development server**
   ```bash
   npm run dev
   ```
   The application will be available at `http://localhost:5173`

## Development

### Available Scripts

- **`npm run dev`**: Start the development server with hot module replacement
- **`npm run build`**: Build the production-ready application
- **`npm run preview`**: Preview the production build locally
- **`npm run lint`**: Run ESLint to check code quality

### Development Workflow

1. Make changes to React components in `src/`
2. Vite's HMR automatically refreshes the browser
3. Run `npm run lint` before committing to catch code issues
4. Test API integration with the configured backend endpoint

### Key Development Files

- **[src/App.jsx](src/App.jsx)**: Main application component with all core logic
- **[src/lib/apiClient.js](src/lib/apiClient.js)**: Authenticated API utility
- **[vite.config.js](vite.config.js)**: Vite configuration with API proxy
- **[tailwind.config.js](tailwind.config.js)**: Tailwind CSS customization

## Building & Deployment

### Production Build

```bash
npm run build
```

This generates an optimized production build in the `dist/` directory.

### Build Output

- Minified JavaScript and CSS
- Lazy-loaded chunks for optimal performance
- Asset optimization with hashing for cache busting

### Deployment

The built `dist/` folder can be deployed to:
- AWS S3 + CloudFront
- Netlify
- Vercel
- Any static hosting service

**Note**: Ensure the Cognito redirect URIs and CORS settings in AWS are updated to match your deployment domain.

## Browser Support

- Chrome (latest)
- Firefox (latest)
- Safari (latest)
- Edge (latest)

## Code Quality

### ESLint Configuration

The project includes ESLint rules enforced through:
- [@eslint/js](https://www.npmjs.com/package/@eslint/js)
- [eslint-plugin-react-hooks](https://www.npmjs.com/package/eslint-plugin-react-hooks)
- [eslint-plugin-react-refresh](https://www.npmjs.com/package/eslint-plugin-react-refresh)

Run linting with: `npm run lint`

## Troubleshooting

### Common Issues

**"Missing VITE_API_BASE_URL"**
- Ensure the `.env` file is properly configured with API endpoint
- Restart the development server after updating environment variables

**Cognito Redirect Loop**
- Verify redirect URIs exactly match in AWS Cognito settings
- Check that `VITE_COGNITO_REDIRECT_URI` and `VITE_COGNITO_LOGOUT_REDIRECT_URI` are correctly set

**Google Maps not loading**
- Confirm API key is valid and has Maps JavaScript API enabled
- Check browser console for Maps API errors
- Verify API key has the correct domain restrictions

## Performance Optimization

- **Vite**: Fast build times and optimized production bundles
- **React 19**: Latest React features and optimizations
- **Lazy Loading**: Code splitting for better initial load times
- **Tailwind CSS**: Purges unused styles for smaller CSS bundles

## Contributing

When contributing to this project:
1. Run `npm run lint` before committing
2. Maintain the existing project structure
3. Use meaningful commit messages
4. Test with real AWS backend endpoints

## License

Proprietary - All rights reserved

## Support

For issues or questions, please contact the development team or create an issue in the repository.

# Coforms

> Thoughtful forms for better answers. Less form. More conversation.

CoForms is a modern, intuitive, full-stack form builder and survey platform built with React, Express, tRPC, Drizzle ORM, and Tailwind CSS. It combines an accessible editor, jump logic, custom themes, real-time response analytics, CSV exports, and AI-assisted form drafting.

## Features

- **Conversational Form Builder**: Create focused, one-question-at-a-time survey experiences that increase completion rates.
- **Smart Jump Logic**: Dynamic conditional branching based on respondent answers.
- **Visual Rhythm & Custom Themes**: Customize fonts, accent colors, background tones, and branded endings.
- **Response Analytics**: Real-time summary metrics, reach rates, completion analytics, and one-click CSV export.
- **AI-Assisted Form Drafting**: Generate complete question flows from natural language prompts using NVIDIA NIM / OpenAI models.
- **Multi-Channel Distribution**: Share via direct link, embeddable iframes, or generated QR codes.
- **Secure Authentication**: Built-in credential-based accounts and Google OAuth sign-in.

## Tech Stack

- **Frontend**: React, Vite, Tailwind CSS, Lucide Icons, QR Code SVG
- **Backend**: Express, tRPC v11, Node.js
- **Database & ORM**: MySQL with Drizzle ORM
- **AI Integration**: NVIDIA NIM / OpenAI API for form generation

## Getting Started

### Prerequisites

- Node.js 20+
- pnpm (or npm / yarn)
- MySQL database

### Setup

1. **Install dependencies:**
   ```bash
   pnpm install
   ```

2. **Configure environment variables:**
   Create a `.env` file with the following keys:
   ```env
   PORT=3000
   DATABASE_URL="mysql://<user>:<password>@<host>:<port>/<database>?ssl=..."
   GOOGLE_CLIENT_ID="<your-google-client-id>"
   GOOGLE_CLIENT_SECRET="<your-google-client-secret>"
   GOOGLE_REDIRECT_URI="http://localhost:3000/api/auth/google/callback"
   NVIDIA_API_KEY="<your-nvidia-api-key>"
   ```
   Register the exact value of `GOOGLE_REDIRECT_URI` as an authorized redirect URI in your Google OAuth client. For production, use the canonical HTTPS URL of your app, for example `https://forms.example.com/api/auth/google/callback`, and set the same URL in the hosting environment. The app uses this configured URL for both the authorization request and token exchange; it does not infer it from proxy headers. Local HTTP is accepted only for `localhost`, `127.0.0.1`, or `[::1]`. Preview deployments need a callback URL registered with Google for that preview, or a separate OAuth client.

3. **Run database migrations:**
   ```bash
   pnpm db:migrate
   ```

4. **Start the development server:**
   ```bash
   pnpm dev
   ```
   Open [http://localhost:3000](http://localhost:3000) to view CoForms.

5. **Build for production:**
   ```bash
   pnpm build
   pnpm start
   ```

## License

MIT © 2026 CoForms

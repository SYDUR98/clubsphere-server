#  ClubSphere – Membership & Event Management for Local Clubs

##  Project Purpose: Defining Secure Digital Spaces

ClubSphere is a full-stack MERN application designed to be the central hub for local club management, discovery, and member engagement.

Our design philosophy centers on creating distinct, secure **"Digital Spaces"** for each user role, ensuring a highly organized and role-aware experience:

* **Discovery Space (Public/Member):** Browsing, searching, and joining clubs and events.
* **Administrative Space (Manager):** Governing club events, members, and resources.
* **Oversight Space (Admin):** Platform governance, role management, and financial monitoring.

This structural uniqueness ensures clarity, security, and a focused workflow for every user interacting with the platform.

##  Live Site URL (Front End)

 [ https://club-sphere-app.web.app/]

 ##  GitHub Repository (Client)

 [ https://github.com/SYDUR98/clubsphere-client]

##  Live Site URL (Back End)

 [ https://clubsphere-server-ruby.vercel.app/]

## GitHub Repository (Server)

 [ https://github.com/SYDUR98/clubsphere-server]


## Frontend Key Features & Technology Highlights

### 1. Frontend Core & Data Management
* **TanStack Query ($\mathbf{5.x}$):** Utilized for server state management, enabling aggressive caching and automatic synchronization across all dashboards.
* **Server-Side Filtering & Sorting:** The **Clubs** listing page implements efficient backend logic to handle search, filter by category, and sorting, enhanced by `use-debounce` for optimal user experience.
* **Framer Motion:** Used strategically to add dynamic elements, such as animated transitions and engaging hover effects.
* **React Hook Form:** Ensures all data input forms are built with streamlined validation, error reporting, and robust performance.

### 2. Frontend Security & Access Control
* **Firebase Authentication:** Handles secure user registration and social sign-in (Google).
* **Role-Based Access Control (RBAC):** Uses `react-router-dom` with custom route wrappers (`AdminRoute`, `ManagerRoute`) to enforce access rules.
* **Stripe Payment Integration:** Seamlessly handles paid membership fees using `@stripe/react-stripe-js`.

### 3. Important npm Packages Used (Client)

| Package | Category | Project Requirement Met |
| :--- | :--- | :--- |
| **`@tanstack/react-query`** | Data Management | **Challenge:** State management and Caching. |
| **`react-hook-form`** | Form Utility | **Challenge:** Robust form validation. |
| **`framer-motion`** | UI/UX | **Core/Challenge:** Animations and dynamic UI effects. |
| **`use-debounce`** | Performance | **Challenge:** Optimized search and filtering. |
| **`chart.js`** | Data Visualization | **Core:** Displaying charts in Overviews. |

---

## Backend Key Features & API

### 1. MERN Stack Core & API
* **Runtime:** Node.js / Express.js
* **Database:** MongoDB Atlas
* **Database Schema:** Clear relational mapping between `users`, `clubs`, `memberships`, `events`, and `eventRegistrations`, `payments`.
* **API Logic:** Handles CRUD operations, status updates (club approval/rejection), and dynamic data fetching.

### 2. Backend Security & RBAC
* **Token Verification Middleware (Challenge Feature):** Custom middleware uses the **Firebase Admin SDK** to verify the client-provided ID token and attach the user's role to the request.
* **Role-Based Access Control:** Enforced via role-specific middleware (`isAdmin`, `isManager`) on all sensitive routes.
* **Environment Security:** Credentials (MongoDB URI, Stripe Secret Key, Firebase Config) secured via `dotenv`.

### 3. Payments Integration
* **Stripe API:** Handles creation of `checkout.session` for secure membership and event fee payments.
* **Membership & Event Logic:** Server-side logic to create records in `memberships` or `eventRegistrations` after successful Stripe payment confirmation.

### 4. Core API Endpoints (Summary)
| Method | Endpoint | Access | Description |
| :--- | :--- | :--- | :--- |
| **Clubs** | | | |
| `GET` | `/clubs/display` | Public | Fetches approved clubs with **Search, Filter, and Sort** capabilities. |
| `GET` | `/clubs/:id` | Public | Fetches detailed information for a specific club. |
| `POST` | `/clubs` | Manager | Creates a new club (initial status: `pending`). |
| `PATCH` | `/clubs/:id` | Manager | Updates details of a club managed by the user. |
| `PATCH` | `/clubs/status/:id` | Admin | Updates club status (`approved`, `rejected`). |
| `GET` | `/manager/my-clubs` | Manager | Fetches all clubs managed by the authenticated user. |
| `POST` | `/clubs/join/:id` | Member | Initiates membership; creates record after payment/free join. |
| `GET` | `/member/clubs` | Member | Fetches all clubs where the user is an active member. |
| `GET` | `/manager/members/:clubId` | Manager | Fetches the list of members for a specific club they manage. |
| **Events** | | | |
| `POST` | `/events` | Manager | Creates a new event for a managed club. |
| `GET` | `/events/club/:clubId` | Public | Fetches all upcoming events for a specific club. |
| `PATCH` | `/events/:id` | Manager | Updates an existing event. |
| `DELETE` | `/events/:id` | Manager | Deletes an event. |
| `POST` | `/events/register/:eventId` | Member | Registers the member for an event (triggers payment if paid). |
| `GET` | `/member/events` | Member | Fetches all events the user has registered for. |
| `GET` | `/manager/registrations/:eventId` | Manager | Fetches the list of registered members for a specific event. |
| **Auth & Users** | | | |
| `POST` | `/users` | Public | Registers a new user (default role: `member`). |
| `GET` | `/user/role` | Member | Checks and returns the authenticated user's role. |
| `PATCH` | `/admin/users/role/:id` | Admin | Updates a user's role (`Manager`/`Admin`/`Member`). |
| `GET` | `/admin/users` | Admin | Fetches the list of all users. |
| **Payments & Stats** | | | |
| `POST` | `/payment/create-checkout-session` | Member | Creates a Stripe session URL for membership payment. |
| `GET` | `/payments/admin` | Admin | Fetches all payment records for platform revenue tracking. |
| `GET` | `/payments/member` | Member | Fetches all payment records for the authenticated user. |
| `GET` | `/stats/admin` | Admin | Fetches platform summary statistics (Total Users, Clubs, Payments). |
| `GET` | `/stats/manager` | Manager | Fetches summary statistics for the manager's clubs/events. |`PATCH` | `/admin/users/role/:id`| Admin | Updates a user's role (Manager/Admin/Member). |

---

## Project Setup and Installation

### 1. Prerequisites
* Node.js (LTS recommended)
* MongoDB Instance (Atlas recommended)

### 2. Client Installation (`clubsphere-client`)
```bash

### 3. Server Installation (clubsphere server)

git clone https://github.com/SYDUR98/clubsphere-server.git

# Install dependencies
npm install

# Run the client
npm run dev

# Clone the server repository
git clone <Your Backend Repo URL>

# Install dependencies
npm install

# Run the server
npm start 
# or for development: npm run dev

### 4. Environment Configuration
File,Variable 
Server .env,"MONGO_URI, STRIPE_SECRET_KEY",Database access and payment processing.
Client .env.local,"VITE_API_URL, VITE_FIREBASE_API_KEY",API endpoint and Firebase public keys.



## Author Information

| Name | Role | Contact | GitHub |
| :--- | :--- | :--- | :--- |
| **[MD SYDUR RAHAMAN]** | Full-Stack Developer | [eng.sydur@gmail.com] | [https://github.com/SYDUR98] |

---
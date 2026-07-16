# Magprint Smart Packaging Platform — Product and Technical Brief

> **How to use this file:** Paste the brief below (Sections 1–18) into Claude Code / Claude Desktop as the project brief. After Claude completes the repository audit, send the **Follow-up Prompt** at the end of this document.

---

You are helping me design and build a hospitality technology platform for **Magprint**, a company that produces custom packaging and printed products for restaurants.

My company is **D3 Hospitality**. I am leading the product strategy, UX, platform design, and technical implementation.

The core idea is to turn ordinary restaurant packaging into **smart, trackable, interactive packaging** using QR codes.

This should not be treated as a simple QR-code landing-page builder. The long-term ambition is to create a hospitality commerce and marketing platform that connects:

- Magprint
- Restaurant owners and operators
- Restaurant customers
- Packaging products
- QR-driven digital experiences
- Analytics
- Reordering
- Payments
- Marketing campaigns
- Customer engagement

---

## 1. The Business Concept

Magprint currently offers approximately nine physical products for restaurants. These may include items such as:

- Takeout containers
- Cups
- Bags
- Coasters
- Lids
- Boxes
- Napkins
- Printed inserts
- Other branded packaging products

Each physical product can include a QR code.

When a restaurant customer scans the QR code, they should be taken to a **branded digital experience** created specifically for that restaurant.

That experience may include:

- The restaurant's story
- Menu links
- Featured dishes
- Promotions
- Events
- Loyalty offers
- Reservations
- Online ordering
- Social-media links
- Videos
- Reviews
- Catering inquiries
- Contact information
- Special campaigns
- Product-specific experiences

The restaurant should be able to manage this experience from its own account.

Magprint should be able to manage restaurants, products, campaigns, orders, and platform-level analytics from an internal admin dashboard.

---

## 2. The Long-Term Vision

The long-term product should become a combination of:

- Smart packaging platform
- Hospitality marketing platform
- QR analytics platform
- Restaurant microsite builder
- Packaging ordering portal
- Customer relationship and campaign platform
- Magprint sales and account-management system

Eventually, a restaurant should be able to:

1. Create an account.
2. Upload its branding.
3. Choose packaging products.
4. Customize products with its logo and visual identity.
5. Create QR experiences for individual products or campaigns.
6. Preview the physical and digital result.
7. Place an order.
8. Pay online.
9. Track production and fulfillment.
10. View scans, clicks, conversions, engagement, and campaign performance.
11. Reorder products.
12. Launch new promotions without needing to reprint the QR code, when dynamic QR codes are used.

This should create recurring value for both Magprint and the restaurant.

**The packaging is the physical entry point. The software, analytics, reordering, and campaigns are the recurring platform.**

---

## 3. Immediate Project Objective

Do **not** build the complete long-term platform at once.

The immediate goal is to create a polished, credible **MVP** that can be demonstrated to Magprint and tested with **four initial restaurants**.

The MVP should prove that:

- A restaurant can have a branded digital profile.
- A QR code can direct customers to that profile.
- Different products or campaigns can have separate QR codes.
- Scan activity can be measured.
- A restaurant owner can update content.
- Magprint can manage restaurant accounts.
- The system could later support ordering, payments, production, and automated reordering.

The MVP should feel like the beginning of a real SaaS product, not a temporary mockup.

---

## 4. User Roles

Design the platform around these roles.

### A. Magprint Super Admin

The Magprint admin should eventually be able to:

- Create and manage restaurant accounts
- Invite restaurant owners
- View all restaurants
- View all packaging products
- Create or edit product records
- Assign products to restaurants
- Create QR codes
- Create campaigns
- View scans and engagement
- View product inquiries and orders
- Manage order status
- View aggregate platform analytics
- Manage subscriptions or service tiers
- Manage platform content
- Impersonate or preview restaurant accounts for support

### B. Restaurant Owner or Manager

The restaurant user should eventually be able to:

- Create or claim an account
- Upload logo and brand assets
- Enter restaurant information
- Add social links
- Add menu, reservation, and ordering links
- Add promotions
- Add featured dishes
- Add videos and images
- Manage QR destinations
- Create campaigns
- View analytics
- Request quotes
- Place orders
- Reorder products
- View order status
- Manage billing
- Invite additional team members

### C. Public Restaurant Customer

The person scanning the QR code should **not** need an account.

They should receive a fast, mobile-first experience with:

- Restaurant branding
- Clear calls to action
- Menu or ordering links
- Promotions
- Social links
- Restaurant story
- Featured content
- Optional loyalty or email capture
- Optional campaign-specific landing pages

---

## 5. MVP Scope

Build the first version around the following features.

### 5.1 Public Restaurant Profile

Each restaurant receives a public page such as:

```
/r/restaurant-slug
```

The page should include:

- Logo
- Cover image
- Restaurant name
- Short description
- Brand colors
- Address
- Phone
- Hours
- Website
- Menu link
- Reservation link
- Online-ordering link
- Instagram
- YouTube
- TikTok
- Featured promotion
- Featured dishes or content cards
- Optional restaurant story
- Clear mobile calls to action

The page must be highly responsive and designed primarily for phone users scanning a QR code.

### 5.2 Campaign Landing Pages

Allow QR codes to point to campaign-specific pages such as:

```
/r/restaurant-slug/c/summer-menu
```

Campaigns may include:

- Promotion title
- Description
- Hero image
- Start and end dates
- Call-to-action button
- Destination link
- Associated packaging product
- Active or inactive status

Examples:

- Happy-hour promotion
- Catering campaign
- New-menu launch
- Holiday menu
- Loyalty sign-up
- Instagram campaign
- Review request
- Chef-story campaign

### 5.3 QR-Code Records

Each QR code should be stored as a database record and associated with:

- Restaurant
- Campaign
- Packaging product
- Destination URL
- Internal label
- Status
- Creation date
- Scan count

Use **dynamic redirect URLs** so the destination can later be changed without changing the printed QR code.

For example:

```
/q/ABC123
```

This route should:

1. Record the scan.
2. Capture permitted analytics.
3. Redirect the user to the correct restaurant or campaign destination.

### 5.4 Basic Analytics

Track at minimum:

- Total scans
- Unique scans where reasonably possible
- Scan date and time
- QR code
- Restaurant
- Campaign
- Packaging product
- Referrer where available
- Device category
- Browser
- Operating system
- Approximate geographic information if legally and technically appropriate
- Destination clicks from the landing page

Restaurant users should only see analytics for their own restaurant.

Magprint admins should see analytics across all restaurants.

Do not overstate the precision of unique users or location data.

### 5.5 Restaurant Dashboard

Create a secure dashboard where restaurant users can:

- Update restaurant profile
- Upload logo and images
- Change brand colors
- Edit links
- Create or edit promotions
- View QR codes
- View basic analytics
- Preview the public profile
- Copy public links

### 5.6 Magprint Admin Dashboard

Create a separate admin experience where Magprint can:

- View all restaurants
- Create a restaurant
- Edit a restaurant
- Invite a restaurant user
- View all campaigns
- View QR codes
- View platform analytics
- View packaging products
- Assign a packaging product to a QR code or campaign
- Disable a restaurant, campaign, or QR code

### 5.7 Product Catalog

Create a structured catalog for the nine Magprint products.

Each product should support:

- Name
- Slug
- Category
- Description
- Product images
- Dimensions
- Material
- Minimum order quantity
- Available print options
- Estimated lead time
- Active status
- Quote-only or fixed-price status
- Optional base price
- Optional customization fields

For the MVP, the catalog may be informational and quote-driven rather than a full checkout system.

### 5.8 Quote or Inquiry Flow

Restaurants should be able to submit an inquiry for a product.

The form should support:

- Restaurant
- Contact name
- Email
- Phone
- Product
- Estimated quantity
- Desired delivery date
- Notes
- Artwork status
- Logo upload
- Reference-image upload

Store the inquiry in the database and make it visible to Magprint admins.

Email notifications can be added if practical.

---

## 6. Features That Are NOT Required in the First MVP

Design the data model so these can be added later, but do not let them delay the MVP:

- Full inventory management
- Automated production workflow
- Shipping integrations
- Tax calculation
- Complex Stripe Connect payouts
- Subscription billing
- Automated reordering
- Restaurant CRM
- Customer loyalty system
- AI-generated marketing campaigns
- Advanced attribution
- POS integrations
- Instagram API integration
- YouTube API integration
- Dynamic menu ingestion
- Multi-language content
- White-label reseller accounts
- Native mobile applications
- Full packaging design editor
- 3D packaging previews

Stub or document these where needed. Do not pretend they are complete.

---

## 7. Phase-Two Scope

After the MVP is validated, the next phase should include:

- Stripe payments
- Deposits
- Saved payment methods
- Order creation
- Order status tracking
- Reordering
- Invoice history
- Product variants
- Quantity pricing
- Artwork approval
- Proof approval
- Production milestones
- Shipping status
- Email and SMS notifications
- Restaurant staff accounts
- Campaign scheduling
- More detailed analytics
- Exportable reports

---

## 8. Phase-Three Ambition

The later platform may include:

- Automated reorder suggestions
- Inventory forecasts for restaurants
- Recommended packaging quantities
- Scan-to-order conversion tracking
- Restaurant customer loyalty
- Email or SMS lead capture
- AI-created campaigns
- AI-generated restaurant microsites
- AI-assisted packaging recommendations
- AI-generated product mockups
- POS integrations
- Reservation integrations
- Online-order integrations
- Multi-location restaurant groups
- Franchise management
- White-label versions for packaging distributors
- Revenue-sharing or subscription models
- Benchmark analytics across restaurants
- Automated campaign optimization

---

## 9. Proposed Technical Stack

Use a modern, maintainable stack.

Preferred direction:

- Next.js
- TypeScript
- React
- Tailwind CSS
- Supabase or PostgreSQL
- Supabase Auth or another secure authentication system
- Supabase Storage or equivalent object storage
- Stripe later
- Vercel deployment
- Server-side authorization
- Row-level security where appropriate
- Analytics captured through first-party application events

Use established libraries rather than building commodity functionality from scratch.

Do not introduce unnecessary microservices.

The initial architecture should be a **clean modular monolith**.

---

## 10. Core Database Entities

Create a proposed schema around these entities:

- `users`
- `organizations`
- `organization_members`
- `restaurants`
- `restaurant_locations`
- `restaurant_branding`
- `products`
- `product_images`
- `product_variants`
- `restaurant_products`
- `campaigns`
- `qr_codes`
- `qr_scan_events`
- `landing_page_events`
- `inquiries`
- `inquiry_files`
- `orders`
- `order_items`
- `payments`
- `subscriptions`
- `uploaded_assets`
- `audit_logs`

For the MVP, orders, payments, and subscriptions may remain partially implemented or reserved for later.

The system must support one restaurant organization having multiple users and eventually multiple locations.

Magprint should be modeled as the **platform operator**, not as an ordinary restaurant account.

---

## 11. Permissions and Security

Implement proper role-based access control.

At minimum:

- `super_admin`
- `magprint_admin`
- `restaurant_owner`
- `restaurant_manager`
- `restaurant_viewer`

Requirements:

- Restaurant users may only access their own organization's data.
- Public users may only access published public content.
- Admin routes must be protected server-side.
- File uploads must be validated.
- Sensitive environment variables must never be exposed to the browser.
- Use signed URLs or properly configured public storage where appropriate.
- Rate-limit QR scan endpoints if necessary.
- Avoid collecting unnecessary personal data.
- Add audit logging for sensitive administrative actions.

---

## 12. UX Direction

The product should feel:

- Premium
- Modern
- Hospitality-driven
- Editorial
- Clean
- Easy for a nontechnical restaurant operator
- More polished than a generic admin template
- Visually aligned with D3 Hospitality's "Dining Done Different" identity

Avoid making it feel like:

- A basic link-in-bio tool
- A generic Shopify clone
- A cheap QR generator
- A developer dashboard
- A cluttered enterprise CRM

The public restaurant pages should be emotional and brand-forward.

The dashboards should be operational, clear, and efficient.

---

## 13. Initial Design Priorities

Focus on these screens first:

1. D3/Magprint platform landing page
2. Restaurant public profile
3. Campaign landing page
4. QR redirect flow
5. Restaurant login
6. Restaurant dashboard overview
7. Restaurant profile editor
8. Campaign editor
9. QR management
10. Analytics dashboard
11. Product catalog
12. Product detail page
13. Quote-request form
14. Magprint admin dashboard
15. Restaurant-management screen
16. Inquiry-management screen

---

## 14. Development Principles

Follow these rules:

- Do not build everything in one pass.
- Start by auditing the repository.
- Explain the current architecture before making major changes.
- Create a phased implementation plan.
- Preserve working functionality.
- Use migrations for database changes.
- Keep types synchronized with the database.
- Use reusable components.
- Avoid massive components.
- Validate all forms.
- Include loading, empty, success, and error states.
- Ensure mobile responsiveness.
- Ensure keyboard accessibility.
- Use realistic seed data.
- Do not use lorem ipsum.
- Do not hardcode restaurant-specific information into reusable components.
- Do not implement fake analytics as though they were real.
- Mark mocked, seeded, and production data clearly.
- Add documentation for setup and deployment.
- Add `.env.example`.
- Add basic tests for important flows.
- Do not expose service-role credentials.
- Do not claim a feature is complete unless it works end to end.

---

## 15. Seed-Data Concept

Create realistic seed data for **four pilot restaurants**.

Each should have:

- Distinct visual identity
- Logo placeholder
- Restaurant description
- Menu link
- Reservation link
- Social links
- One or two campaigns
- Multiple QR codes
- Associated Magprint products
- Sample scan events

The purpose is to demonstrate how the system could scale across different restaurant brands.

---

## 16. Commercial Logic

The platform may eventually generate revenue through:

- Setup fees
- Monthly SaaS subscriptions
- Packaging sales
- Premium analytics
- Campaign management
- Design services
- Transaction fees
- Reordering fees
- White-label licensing

Do not hardcode a pricing model into the MVP yet.

The system should be designed so plans and feature limits can be added later.

---

## 17. Immediate Task for You

Before writing large amounts of code:

1. Inspect the current repository.
2. Explain what already exists.
3. Identify technical debt or risks.
4. Propose the cleanest MVP architecture.
5. Produce a phased implementation plan.
6. List the database schema changes.
7. List the routes and screens.
8. Define the authentication and authorization model.
9. Identify what should be real versus mocked in the first demo.
10. Then implement Phase 1 in small, testable steps.

Do not begin by attempting the entire platform at once.

The first milestone should be:

- Working authentication
- One Magprint admin role
- One restaurant account
- Editable restaurant profile
- Public restaurant page
- One campaign
- One dynamic QR redirect
- Real scan-event recording
- Basic analytics
- One quote-request workflow

Once that works end to end, expand it into the full four-restaurant pilot.

---

## 18. Definition of Success

The first successful demo should allow me to show Magprint the following story:

1. Magprint creates a restaurant account.
2. The restaurant signs in.
3. The restaurant customizes its branded public profile.
4. The restaurant creates a campaign.
5. Magprint associates the campaign with a packaging product.
6. The platform generates a QR code.
7. A customer scans the QR code.
8. The scan is recorded.
9. The customer sees the restaurant campaign.
10. The restaurant sees the scan in its analytics.
11. The restaurant submits a packaging inquiry or reorder request.
12. Magprint sees and manages the inquiry.

**That complete loop matters more than having dozens of unfinished features.**

Begin by returning:

- Repository audit
- Recommended architecture
- Proposed schema
- Route map
- MVP implementation sequence
- Risks and open questions

Do not make destructive changes until the plan has been reviewed.

---

# Follow-up Prompt

> **Send this second prompt after Claude completes the repository audit.**

Proceed with the **first vertical slice only**.

Build one complete end-to-end workflow:

1. Magprint admin creates a restaurant.
2. Restaurant owner can authenticate.
3. Restaurant owner edits the restaurant profile.
4. Public restaurant page renders from database content.
5. Admin or restaurant owner creates one campaign.
6. A dynamic QR code points to the campaign.
7. Scanning the QR code creates a scan-event record.
8. The scan redirects to the campaign page.
9. Restaurant dashboard displays the real scan count.
10. Public visitor can submit a packaging inquiry.
11. Magprint admin can view the inquiry.

Use production-quality structure, but keep the scope narrow.

Do not add Stripe, subscriptions, inventory automation, shipping, AI content generation, or POS integrations yet.

At the end, provide:

- Files created or changed
- Database migrations
- Environment variables required
- Manual setup steps
- Test credentials
- Test procedure
- Known limitations
- Recommended next milestone

---

# Guiding Note

The key is to make Claude understand that this is **not merely a website for Magprint**. It is the foundation of a vertically integrated hospitality platform where printed packaging becomes a measurable digital sales and marketing channel. At the same time, prevent Claude from trying to build the entire vision before the first usable loop works.

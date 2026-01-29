# Admin Setup

The admin panel (`/admin`) is restricted to users with `role = 'ADMIN'`. Middleware redirects non-admins to `/dashboard`.

## Creating an admin user

1. Register a user via `/auth/signup` or ensure the account exists.
2. Set `role` to `ADMIN` in the database:

   ```sql
   UPDATE "User" SET role = 'ADMIN' WHERE email = 'admin@example.com';
   ```

   Or via Prisma Studio: `npx prisma studio` → **User** → edit the user → set **role** to `ADMIN`.

3. Sign in with that account and open `/admin`.

## Admin features

- **Dashboard** (`/admin`): User, property, and appeal counts.
- **Users** (`/admin/users`): List all users with role, plan, property/appeal counts.
- **Appeals** (`/admin/appeals`): List all appeals; link to appeal detail. Admins can GET and PATCH any appeal via the API.

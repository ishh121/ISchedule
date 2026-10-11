# Security policy

Report security issues privately to the repository owner rather than opening a public issue. Do not include passwords, session cookies, database files, or production environment variables in reports or commits.

Production deployments should run behind HTTPS with a persistent private `ISCHEDULE_DATA_DIR`, restricted `PUBLIC_ORIGIN`, regular `npm run backup` jobs, and SMTP credentials supplied through environment variables.

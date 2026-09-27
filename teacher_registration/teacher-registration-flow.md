# Teacher registration flow

This project now uses a single draft key for the teacher registration flow:

- key: smartLearningTeacherRegistration
- step1: personal information (including password only until final account creation)
- step2: professional information
- confirmed: review confirmation state

The flow is intentionally kept in localStorage during the registration journey because the account is created only at the final review step.

Key requirements enforced by the front-end:

- Step 1 validates all required fields before navigation.
- Step 2 validates the teaching mode and required grade/stream/subject selections.
- Review displays a safe password indicator instead of the actual password.
- Final signup calls Supabase Auth only at the final Create Teacher Account step.
- The draft is cleared only after a successful account creation and redirect.

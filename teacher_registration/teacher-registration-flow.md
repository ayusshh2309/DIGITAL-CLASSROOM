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
- The professional step reads the public subject catalog and derives each subject's grade and stream options from `subjects.grades` and `subjects.streams`.
- Review displays a safe password indicator instead of the actual password.
- Final signup calls Supabase Auth only at the final Create Teacher Account step.
- After signup, the authenticated teacher profile is created before grade groups and subject assignments are saved with its database ID.
- Teach All saves grade groups with `teach_all_subjects`; Subject Specialist saves only the individually selected `teacher_subject_assignments`.
- The draft is cleared only after a successful account creation and redirect.

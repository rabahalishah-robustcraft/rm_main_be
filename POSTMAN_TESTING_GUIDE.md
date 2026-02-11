# Postman Testing Guide - AI Audio Summarization Backend

This guide provides step-by-step instructions for testing the complete user flow from signup to getting AI analysis using Postman.

## Prerequisites

1. **Start the backend server**:
   ```bash
   npm run dev
   ```
   Server should be running on `http://localhost:3000` (or your configured PORT)

2. **Environment Variables**: Ensure your `.env` file has:
   - `OPENAI_API_KEY` - For GPT analysis
   - `WHISPER_API_KEY` - For audio transcription
   - `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_S3_BUCKET` - For S3 storage

3. **Postman Setup**: Create a new collection called "AI Audio Summarization API"

---

## Complete User Flow Testing

### Step 1: Register a New User

**Endpoint**: `POST http://localhost:3000/api/auth/register`

**Headers**:
```
Content-Type: application/json
```

**Body** (raw JSON):
```json
{
  "email": "testuser@example.com",
  "password": "SecurePassword123!"
}
```

**Expected Response** (201 Created):
```json
{
  "success": true,
  "message": "User registered successfully",
  "user": {
    "id": "uuid-here",
    "email": "testuser@example.com",
    "subscriptionTier": "free",
    "createdAt": "2026-02-11T...",
    "updatedAt": "2026-02-11T..."
  },
  "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
}
```

**Action**: Copy the `token` value - you'll need it for all subsequent requests!

---

### Step 2: Get Current User Info

**Endpoint**: `GET http://localhost:3000/api/auth/me`

**Headers**:
```
Authorization: Bearer YOUR_TOKEN_HERE
```

**Expected Response** (200 OK):
```json
{
  "id": "uuid-here",
  "email": "testuser@example.com",
  "subscriptionTier": "free",
  "createdAt": "2026-02-11T...",
  "updatedAt": "2026-02-11T..."
}
```

---

### Step 3: Get User Profile

**Endpoint**: `GET http://localhost:3000/api/profile`

**Headers**:
```
Authorization: Bearer YOUR_TOKEN_HERE
```

**Expected Response** (200 OK):
```json
{
  "success": true,
  "data": {
    "id": "uuid-here",
    "userId": "uuid-here",
    "targetIndustry": null,
    "targetJobTitle": null,
    "experienceLevel": null,
    "extractedSkills": [],
    "aiAttributes": null,
    "resumeS3Key": null,
    "createdAt": "2026-02-11T...",
    "updatedAt": "2026-02-11T..."
  }
}
```

---

### Step 4: Update Profile with Target Role

**Endpoint**: `PUT http://localhost:3000/api/profile/target-role`

**Headers**:
```
Authorization: Bearer YOUR_TOKEN_HERE
Content-Type: application/json
```

**Body** (raw JSON):
```json
{
  "targetIndustry": "Technology",
  "targetJobTitle": "Software Engineer"
}
```

**Expected Response** (200 OK):
```json
{
  "success": true,
  "message": "Target role updated successfully"
}
```

---

### Step 5: Upload Resume (PDF)

**Endpoint**: `POST http://localhost:3000/api/profile/resume`

**Headers**:
```
Authorization: Bearer YOUR_TOKEN_HERE
```

**Body** (form-data):
- Key: `resume` (type: File)
- Value: Select a PDF resume file from your computer

**Expected Response** (200 OK):
```json
{
  "success": true,
  "data": {
    "resumeS3Key": "resumes/uuid-here/resume-timestamp.pdf",
    "filename": "your-resume.pdf",
    "size": 123456
  },
  "message": "Resume uploaded successfully"
}
```

**Note**: The resume will be processed asynchronously. Wait 5-10 seconds before checking the profile again.

---

### Step 6: Check Profile After Resume Processing

**Endpoint**: `GET http://localhost:3000/api/profile`

**Headers**:
```
Authorization: Bearer YOUR_TOKEN_HERE
```

**Expected Response** (200 OK):
```json
{
  "success": true,
  "data": {
    "id": "uuid-here",
    "userId": "uuid-here",
    "targetIndustry": "Technology",
    "targetJobTitle": "Software Engineer",
    "experienceLevel": "mid",
    "extractedSkills": [
      "JavaScript",
      "TypeScript",
      "React",
      "Node.js",
      "Python"
    ],
    "aiAttributes": null,
    "resumeS3Key": "resumes/uuid-here/resume-timestamp.pdf",
    "createdAt": "2026-02-11T...",
    "updatedAt": "2026-02-11T..."
  }
}
```

**Verification**: Check that `extractedSkills` and `experienceLevel` are populated!

---

### Step 7: Get Resume Download URL

**Endpoint**: `GET http://localhost:3000/api/profile/resume/url`

**Headers**:
```
Authorization: Bearer YOUR_TOKEN_HERE
```

**Query Parameters** (optional):
- `expiresIn`: 3600 (seconds, default is 1 hour)

**Expected Response** (200 OK):
```json
{
  "success": true,
  "data": {
    "url": "https://your-bucket.s3.amazonaws.com/resumes/...?X-Amz-Algorithm=...",
    "expiresIn": 3600,
    "expiresAt": "2026-02-11T..."
  },
  "message": "Resume URL generated successfully"
}
```

**Action**: You can copy the URL and paste it in a browser to download your resume!

---

### Step 8: Check Subscription Info

**Endpoint**: `GET http://localhost:3000/api/subscription/info`

**Headers**:
```
Authorization: Bearer YOUR_TOKEN_HERE
```

**Expected Response** (200 OK):
```json
{
  "success": true,
  "data": {
    "tier": "free",
    "currentUsage": 0,
    "limit": 5,
    "canCreateSession": true
  }
}
```

---

### Step 9: Start Audio Session

**Endpoint**: `POST http://localhost:3000/api/sessions/start`

**Headers**:
```
Authorization: Bearer YOUR_TOKEN_HERE
```

**Body**: None (empty)

**Expected Response** (201 Created):
```json
{
  "success": true,
  "data": {
    "sessionId": "session-uuid-here",
    "status": "pending",
    "createdAt": "2026-02-11T..."
  }
}
```

**Action**: Copy the `sessionId` - you'll need it for the next step!

---

### Step 10: Upload Audio to Session

**Endpoint**: `POST http://localhost:3000/api/sessions/{sessionId}/audio`

Replace `{sessionId}` with the actual session ID from Step 9.

**Headers**:
```
Authorization: Bearer YOUR_TOKEN_HERE
```

**Body** (form-data):
- Key: `audio` (type: File)
- Value: Select an audio file (WAV, MP3, M4A, etc.) from your computer

**Expected Response** (200 OK):
```json
{
  "success": true,
  "message": "Audio uploaded successfully. Processing started.",
  "data": {
    "sessionId": "session-uuid-here",
    "status": "processing"
  }
}
```

**Note**: Audio processing takes 10-30 seconds depending on file size. The system will:
1. Upload audio to S3
2. Transcribe using Whisper API
3. Analyze using GPT API
4. Update session with results

---

### Step 11: Check Session Status (Wait 15-30 seconds)

**Endpoint**: `GET http://localhost:3000/api/sessions/{sessionId}`

Replace `{sessionId}` with your session ID.

**Headers**:
```
Authorization: Bearer YOUR_TOKEN_HERE
```

**Expected Response** (200 OK):
```json
{
  "success": true,
  "data": {
    "id": "session-uuid-here",
    "status": "completed",
    "transcript": "Hello, my name is John and I'm applying for the software engineer position...",
    "aiAnalysis": {
      "feedback": "Your response demonstrates strong technical knowledge...",
      "strengths": [
        "Clear articulation of technical concepts",
        "Good use of specific examples"
      ],
      "improvements": [
        "Could provide more detail about team collaboration",
        "Consider adding metrics to quantify achievements"
      ],
      "insights": [
        "Strong alignment with target role requirements",
        "Demonstrates mid-level experience effectively"
      ]
    },
    "scores": {
      "clarity": 85,
      "confidence": 78,
      "tone": 82,
      "enthusiasm": 75,
      "specificity": 80
    },
    "analysisComplete": true,
    "processingError": null,
    "createdAt": "2026-02-11T...",
    "updatedAt": "2026-02-11T..."
  }
}
```

**If still processing**, you'll see:
```json
{
  "success": true,
  "data": {
    "id": "session-uuid-here",
    "status": "processing",
    "transcript": null,
    "aiAnalysis": null,
    "scores": {
      "clarity": null,
      "confidence": null,
      "tone": null,
      "enthusiasm": null,
      "specificity": null
    },
    "analysisComplete": false,
    ...
  }
}
```

**Action**: Wait a bit longer and check again!

---

### Step 12: Get Session History

**Endpoint**: `GET http://localhost:3000/api/sessions/history`

**Headers**:
```
Authorization: Bearer YOUR_TOKEN_HERE
```

**Query Parameters** (optional):
- `limit`: 20 (default, max 100)

**Expected Response** (200 OK):
```json
{
  "success": true,
  "data": {
    "sessions": [
      {
        "id": "session-uuid-1",
        "status": "completed",
        "scores": {
          "clarity": 85,
          "confidence": 78,
          "tone": 82,
          "enthusiasm": 75,
          "specificity": 80
        },
        "createdAt": "2026-02-11T...",
        "updatedAt": "2026-02-11T..."
      }
    ],
    "total": 1
  }
}
```

---

### Step 13: Get AI Attributes

**Endpoint**: `GET http://localhost:3000/api/profile/ai-attributes`

**Headers**:
```
Authorization: Bearer YOUR_TOKEN_HERE
```

**Expected Response** (200 OK):
```json
{
  "success": true,
  "data": {
    "averageClarity": 85,
    "averageConfidence": 78,
    "averageTone": 82,
    "averageEnthusiasm": 75,
    "averageSpecificity": 80,
    "totalSessions": 1,
    "lastUpdated": "2026-02-11T..."
  }
}
```

---

## Additional Test Scenarios

### Test 14: Upgrade Subscription (Optional)

**Endpoint**: `POST http://localhost:3000/api/subscription/upgrade`

**Headers**:
```
Authorization: Bearer YOUR_TOKEN_HERE
Content-Type: application/json
```

**Body** (raw JSON):
```json
{
  "tier": "paid"
}
```

**Expected Response** (200 OK):
```json
{
  "success": true,
  "message": "Subscription upgraded to paid tier successfully",
  "data": {
    "tier": "paid"
  }
}
```

---

### Test 15: Update Profile Information

**Endpoint**: `PUT http://localhost:3000/api/profile`

**Headers**:
```
Authorization: Bearer YOUR_TOKEN_HERE
Content-Type: application/json
```

**Body** (raw JSON):
```json
{
  "targetIndustry": "Finance",
  "targetJobTitle": "Senior Software Engineer",
  "experienceLevel": "senior"
}
```

**Expected Response** (200 OK):
```json
{
  "success": true,
  "data": {
    "id": "uuid-here",
    "userId": "uuid-here",
    "targetIndustry": "Finance",
    "targetJobTitle": "Senior Software Engineer",
    "experienceLevel": "senior",
    ...
  },
  "message": "Profile updated successfully"
}
```

---

### Test 16: Login (Existing User)

**Endpoint**: `POST http://localhost:3000/api/auth/login`

**Headers**:
```
Content-Type: application/json
```

**Body** (raw JSON):
```json
{
  "email": "testuser@example.com",
  "password": "SecurePassword123!"
}
```

**Expected Response** (200 OK):
```json
{
  "success": true,
  "message": "Login successful",
  "user": {
    "id": "uuid-here",
    "email": "testuser@example.com",
    "subscriptionTier": "free",
    ...
  },
  "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
}
```

---

### Test 17: Logout

**Endpoint**: `POST http://localhost:3000/api/auth/logout`

**Headers**:
```
Authorization: Bearer YOUR_TOKEN_HERE
```

**Expected Response** (200 OK):
```json
{
  "success": true,
  "message": "Logout successful"
}
```

---

## Error Testing Scenarios

### Test 18: Invalid Login Credentials

**Endpoint**: `POST http://localhost:3000/api/auth/login`

**Body**:
```json
{
  "email": "testuser@example.com",
  "password": "WrongPassword123!"
}
```

**Expected Response** (401 Unauthorized):
```json
{
  "error": {
    "code": "INVALID_CREDENTIALS",
    "message": "Invalid email or password"
  },
  "timestamp": "2026-02-11T...",
  "path": "/api/auth/login"
}
```

---

### Test 19: Access Without Token

**Endpoint**: `GET http://localhost:3000/api/profile`

**Headers**: None (no Authorization header)

**Expected Response** (401 Unauthorized):
```json
{
  "error": {
    "code": "MISSING_TOKEN",
    "message": "Authorization token is required"
  },
  "timestamp": "2026-02-11T...",
  "path": "/api/profile"
}
```

---

### Test 20: Upload Invalid File Type

**Endpoint**: `POST http://localhost:3000/api/profile/resume`

**Headers**:
```
Authorization: Bearer YOUR_TOKEN_HERE
```

**Body** (form-data):
- Key: `resume` (type: File)
- Value: Select a .txt or .jpg file (not PDF/DOC)

**Expected Response** (400 Bad Request):
```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Only PDF and DOC/DOCX files are allowed"
  },
  "timestamp": "2026-02-11T...",
  "path": "/api/profile/resume"
}
```

---

## Postman Collection Setup Tips

### 1. Create Environment Variables

In Postman, create an environment with these variables:
- `baseUrl`: `http://localhost:3000`
- `token`: (leave empty, will be set automatically)
- `sessionId`: (leave empty, will be set automatically)

### 2. Auto-Save Token After Login/Register

In the "Tests" tab of your login/register requests, add:
```javascript
if (pm.response.code === 200 || pm.response.code === 201) {
    const response = pm.response.json();
    pm.environment.set("token", response.token);
}
```

### 3. Auto-Save Session ID

In the "Tests" tab of your "Start Session" request, add:
```javascript
if (pm.response.code === 201) {
    const response = pm.response.json();
    pm.environment.set("sessionId", response.data.sessionId);
}
```

### 4. Use Variables in Requests

- Base URL: `{{baseUrl}}/api/auth/register`
- Authorization: `Bearer {{token}}`
- Session endpoint: `{{baseUrl}}/api/sessions/{{sessionId}}`

---

## Testing Checklist

- [ ] Step 1: Register new user ✓
- [ ] Step 2: Get current user info ✓
- [ ] Step 3: Get user profile ✓
- [ ] Step 4: Update target role ✓
- [ ] Step 5: Upload resume ✓
- [ ] Step 6: Verify resume processing (skills extracted) ✓
- [ ] Step 7: Get resume download URL ✓
- [ ] Step 8: Check subscription info ✓
- [ ] Step 9: Start audio session ✓
- [ ] Step 10: Upload audio file ✓
- [ ] Step 11: Check session status (wait for completion) ✓
- [ ] Step 12: Get session history ✓
- [ ] Step 13: Get AI attributes ✓
- [ ] Step 14: Test subscription upgrade ✓
- [ ] Step 15: Update profile ✓
- [ ] Step 16: Login existing user ✓
- [ ] Step 17: Logout ✓
- [ ] Step 18-20: Error scenarios ✓

---

## Troubleshooting

### Issue: "Token is invalid or expired"
**Solution**: Login again to get a fresh token

### Issue: "Session still processing after 2 minutes"
**Solution**: Check server logs for errors. Verify OpenAI API keys are valid.

### Issue: "Resume skills not extracted"
**Solution**: Wait 10-15 seconds after upload. Check that OPENAI_API_KEY is configured.

### Issue: "Audio upload fails"
**Solution**: 
- Verify file is a valid audio format (WAV, MP3, M4A)
- Check file size is under limit (default 10MB)
- Verify AWS S3 credentials are configured

### Issue: "Usage limit exceeded"
**Solution**: 
- Free tier allows 5 sessions per month
- Upgrade to paid tier or wait for monthly reset
- Check subscription info endpoint

---

## Expected Processing Times

- **Resume Upload**: Instant upload, 5-15 seconds for AI processing
- **Audio Upload**: Instant upload, 10-30 seconds for transcription + analysis
- **Profile Updates**: Instant
- **Session Creation**: Instant

---

## Success Indicators

✅ **Complete Flow Success**:
1. User registered with token received
2. Profile created automatically
3. Target role set successfully
4. Resume uploaded and skills extracted
5. Audio session created
6. Audio uploaded and processed
7. Transcript and AI analysis received
8. Scores calculated (clarity, confidence, tone, enthusiasm, specificity)
9. Session history shows completed session
10. AI attributes updated with averages

---

## Notes

- All timestamps are in ISO 8601 format (UTC)
- UUIDs are used for all IDs
- Tokens expire after 24 hours (configurable)
- Free tier: 5 sessions/month, Paid tier: 50 sessions/month
- Maximum file sizes: Resume 5MB, Audio 10MB
- Supported resume formats: PDF, DOC, DOCX
- Supported audio formats: WAV, MP3, M4A, OGG, FLAC

---

Happy Testing! 🚀

/**
 * Quiz Management Helpers
 * Functions for creating, managing, and taking quizzes
 */

const getClient = () => {
  if (!window.appClient) {
    throw new Error('Supabase client not initialized');
  }
  return window.appClient;
};

// =====================================================================
// QUIZ CREATION & MANAGEMENT (Teacher)
// =====================================================================

/**
 * Create a new quiz
 * @param {object} quizData - Quiz details
 * @returns {Promise<{quiz, error}>}
 */
async function createQuiz(quizData) {
  try {
    const client = getClient();
    const { data: { user } } = await client.auth.getUser();

    // Get teacher DB ID
    const { data: teacher } = await client
      .from('teachers')
      .select('id')
      .eq('auth_user_id', user.id)
      .single();

    const { data: quiz, error } = await client
      .from('quizzes')
      .insert({
        teacher_db_id: teacher?.id,
        teacher_auth_id: user.id,
        teacher_name: quizData.teacherName,
        subject: quizData.subject,
        class_level: quizData.classLevel,
        chapter: quizData.chapter,
        title: quizData.title,
        description: quizData.description,
        total_marks: quizData.totalMarks || 100,
        time_limit_minutes: quizData.timeLimitMinutes || 60,
        passing_percentage: quizData.passingPercentage || 40,
        is_published: false
      })
      .select()
      .single();

    return { quiz, error };
  } catch (err) {
    return { quiz: null, error: err };
  }
}

/**
 * Add questions to a quiz
 * @param {number} quizId - Quiz ID
 * @param {array} questions - Array of question objects
 * @returns {Promise<{questions, error}>}
 */
async function addQuizQuestions(quizId, questions) {
  try {
    const client = getClient();

    // Calculate total marks and update quiz
    const totalMarks = questions.reduce((sum, q) => sum + (q.marks || 1), 0);
    await client
      .from('quizzes')
      .update({ total_questions: questions.length, total_marks: totalMarks })
      .eq('id', quizId);

    // Insert questions
    const questionsToInsert = questions.map((q, index) => ({
      quiz_id: quizId,
      question_number: index + 1,
      question_text: q.questionText,
      question_type: q.questionType, // multiple_choice, short_answer, essay, true_false
      marks: q.marks || 1,
      options: q.options || null, // JSON array for multiple choice
      correct_answer: q.correctAnswer,
      explanation: q.explanation || null
    }));

    const { data, error } = await client
      .from('quiz_questions')
      .insert(questionsToInsert)
      .select();

    return { questions: data, error };
  } catch (err) {
    return { questions: null, error: err };
  }
}

/**
 * Publish a quiz (make it available to learners)
 * @param {number} quizId - Quiz ID
 * @returns {Promise<{error}>}
 */
async function publishQuiz(quizId) {
  try {
    const client = getClient();
    const { error } = await client
      .from('quizzes')
      .update({ is_published: true })
      .eq('id', quizId);

    return { error };
  } catch (err) {
    return { error: err };
  }
}

/**
 * Update quiz details
 * @param {number} quizId - Quiz ID
 * @param {object} updates - Fields to update
 * @returns {Promise<{quiz, error}>}
 */
async function updateQuiz(quizId, updates) {
  try {
    const client = getClient();
    const { data: quiz, error } = await client
      .from('quizzes')
      .update(updates)
      .eq('id', quizId)
      .select()
      .single();

    return { quiz, error };
  } catch (err) {
    return { quiz: null, error: err };
  }
}

/**
 * Delete a quiz
 * @param {number} quizId - Quiz ID
 * @returns {Promise<{error}>}
 */
async function deleteQuiz(quizId) {
  try {
    const client = getClient();
    const { error } = await client
      .from('quizzes')
      .delete()
      .eq('id', quizId);

    return { error };
  } catch (err) {
    return { error: err };
  }
}

/**
 * Get teacher's quizzes
 * @param {object} filters - Filter options (subject, classLevel, etc.)
 * @returns {Promise<{quizzes, error}>}
 */
async function getTeacherQuizzes(filters = {}) {
  try {
    const client = getClient();
    const { data: { user } } = await client.auth.getUser();

    let query = client
      .from('quizzes')
      .select('*')
      .eq('teacher_auth_id', user.id);

    if (filters.subject) query = query.eq('subject', filters.subject);
    if (filters.classLevel) query = query.eq('class_level', filters.classLevel);
    if (filters.published !== undefined) query = query.eq('is_published', filters.published);

    const { data: quizzes, error } = await query.order('created_at', { ascending: false });

    return { quizzes, error };
  } catch (err) {
    return { quizzes: null, error: err };
  }
}

// =====================================================================
// QUIZ TAKING (Learner)
// =====================================================================

/**
 * Get available quizzes for learner
 * @param {object} filters - Filter by subject, classLevel, etc.
 * @returns {Promise<{quizzes, error}>}
 */
async function getAvailableQuizzes(filters = {}) {
  try {
    const client = getClient();

    let query = client
      .from('quizzes')
      .select('id, title, description, subject, class_level, chapter, total_questions, total_marks, time_limit_minutes, passing_percentage, teacher_name, created_at')
      .eq('is_published', true);

    if (filters.subject) query = query.eq('subject', filters.subject);
    if (filters.classLevel) query = query.eq('class_level', filters.classLevel);

    const { data: quizzes, error } = await query.order('created_at', { ascending: false });

    return { quizzes, error };
  } catch (err) {
    return { quizzes: null, error: err };
  }
}

/**
 * Get quiz questions
 * @param {number} quizId - Quiz ID
 * @returns {Promise<{questions, error}>}
 */
async function getQuizQuestions(quizId) {
  try {
    const client = getClient();
    const { data: questions, error } = await client
      .from('quiz_questions')
      .select('*')
      .eq('quiz_id', quizId)
      .order('question_number', { ascending: true });

    return { questions, error };
  } catch (err) {
    return { questions: null, error: err };
  }
}

/**
 * Start a quiz attempt
 * @param {number} quizId - Quiz ID
 * @returns {Promise<{attempt, error}>}
 */
async function startQuizAttempt(quizId) {
  try {
    const client = getClient();
    const { data: { user } } = await client.auth.getUser();

    // Get learner DB ID
    const { data: learner } = await client
      .from('learners')
      .select('id')
      .eq('auth_user_id', user.id)
      .single();

    const { data: attempt, error } = await client
      .from('quiz_attempts')
      .insert({
        quiz_id: quizId,
        learner_db_id: learner?.id,
        learner_auth_id: user.id,
        started_at: new Date().toISOString()
      })
      .select()
      .single();

    return { attempt, error };
  } catch (err) {
    return { attempt: null, error: err };
  }
}

/**
 * Submit quiz answer
 * @param {number} attemptId - Quiz attempt ID
 * @param {number} questionId - Quiz question ID
 * @param {string} answer - Learner's answer
 * @returns {Promise<{response, error}>}
 */
async function submitQuizAnswer(attemptId, questionId, answer) {
  try {
    const client = getClient();

    // Get question details
    const { data: question } = await client
      .from('quiz_questions')
      .select('*')
      .eq('id', questionId)
      .single();

    // Check if answer is correct
    const isCorrect = question?.correct_answer === answer;
    const marksObtained = isCorrect ? question?.marks : 0;

    // Save response
    const { data: response, error } = await client
      .from('quiz_responses')
      .insert({
        quiz_attempt_id: attemptId,
        quiz_question_id: questionId,
        learner_answer: answer,
        is_correct: isCorrect,
        marks_obtained: marksObtained
      })
      .select()
      .single();

    return { response, error };
  } catch (err) {
    return { response: null, error: err };
  }
}

/**
 * Complete and score a quiz attempt
 * @param {number} attemptId - Quiz attempt ID
 * @returns {Promise<{attempt, error}>}
 */
async function completeQuizAttempt(attemptId) {
  try {
    const client = getClient();

    // Get all responses for this attempt
    const { data: responses } = await client
      .from('quiz_responses')
      .select('marks_obtained')
      .eq('quiz_attempt_id', attemptId);

    const totalScore = responses?.reduce((sum, r) => sum + (r.marks_obtained || 0), 0) || 0;

    // Get quiz details
    const { data: attempt } = await client
      .from('quiz_attempts')
      .select('quiz_id, started_at')
      .eq('id', attemptId)
      .single();

    const { data: quiz } = await client
      .from('quizzes')
      .select('total_marks, passing_percentage')
      .eq('id', attempt?.quiz_id)
      .single();

    const percentage = (totalScore / quiz?.total_marks) * 100;
    const isPassed = percentage >= (quiz?.passing_percentage || 40);
    const timeTaken = Math.round((new Date() - new Date(attempt?.started_at)) / 1000);

    // Update attempt
    const { data: updatedAttempt, error } = await client
      .from('quiz_attempts')
      .update({
        completed_at: new Date().toISOString(),
        score: totalScore,
        total_marks: quiz?.total_marks,
        percentage: Math.round(percentage * 100) / 100,
        is_passed: isPassed,
        time_taken_seconds: timeTaken
      })
      .eq('id', attemptId)
      .select()
      .single();

    // Update learner progress
    if (updatedAttempt) {
      await updateLearnerProgress(updatedAttempt.learner_auth_id, updatedAttempt.quiz_id);
    }

    return { attempt: updatedAttempt, error };
  } catch (err) {
    return { attempt: null, error: err };
  }
}

/**
 * Get learner's quiz attempts
 * @param {object} filters - Filter by quiz, date range, etc.
 * @returns {Promise<{attempts, error}>}
 */
async function getLearnerAttempts(filters = {}) {
  try {
    const client = getClient();
    const { data: { user } } = await client.auth.getUser();

    let query = client
      .from('quiz_attempts')
      .select('*')
      .eq('learner_auth_id', user.id);

    if (filters.quizId) query = query.eq('quiz_id', filters.quizId);

    const { data: attempts, error } = await query.order('created_at', { ascending: false });

    return { attempts, error };
  } catch (err) {
    return { attempts: null, error: err };
  }
}

/**
 * Get quiz attempt details with answers
 * @param {number} attemptId - Quiz attempt ID
 * @returns {Promise<{attempt, responses, error}>}
 */
async function getAttemptDetails(attemptId) {
  try {
    const client = getClient();

    const { data: attempt, error: attemptError } = await client
      .from('quiz_attempts')
      .select('*')
      .eq('id', attemptId)
      .single();

    if (attemptError) return { attempt: null, responses: null, error: attemptError };

    const { data: responses, error: responsesError } = await client
      .from('quiz_responses')
      .select('*, quiz_questions(*)')
      .eq('quiz_attempt_id', attemptId)
      .order('id', { ascending: true });

    return { attempt, responses, error: responsesError };
  } catch (err) {
    return { attempt: null, responses: null, error: err };
  }
}

// =====================================================================
// PROGRESS TRACKING
// =====================================================================

/**
 * Update learner progress
 * @param {string} learnerAuthId - Learner auth ID
 * @param {number} quizId - Quiz ID
 * @returns {Promise<{progress, error}>}
 */
async function updateLearnerProgress(learnerAuthId, quizId) {
  try {
    const client = getClient();

    // Get quiz details
    const { data: quiz } = await client
      .from('quizzes')
      .select('subject, class_level')
      .eq('id', quizId)
      .single();

    // Get learner DB ID
    const { data: learner } = await client
      .from('learners')
      .select('id')
      .eq('auth_user_id', learnerAuthId)
      .single();

    // Calculate stats
    const { data: attempts } = await client
      .from('quiz_attempts')
      .select('is_passed, percentage')
      .eq('learner_auth_id', learnerAuthId)
      .eq('quiz_id', quizId);

    const totalQuizzes = attempts?.length || 0;
    const passedQuizzes = attempts?.filter(a => a.is_passed)?.length || 0;
    const avgScore = attempts?.reduce((sum, a) => sum + (a.percentage || 0), 0) / totalQuizzes || 0;

    // Upsert progress record
    const { data: progress, error } = await client
      .from('learner_progress')
      .upsert({
        learner_db_id: learner?.id,
        learner_auth_id: learnerAuthId,
        subject: quiz?.subject,
        class_level: quiz?.class_level,
        total_quizzes_taken: totalQuizzes,
        total_quizzes_passed: passedQuizzes,
        average_score: Math.round(avgScore * 100) / 100,
        last_activity_at: new Date().toISOString()
      }, {
        onConflict: 'learner_db_id,subject'
      })
      .select()
      .single();

    return { progress, error };
  } catch (err) {
    return { progress: null, error: err };
  }
}

/**
 * Get learner progress
 * @returns {Promise<{progress, error}>}
 */
async function getLearnerProgress() {
  try {
    const client = getClient();
    const { data: { user } } = await client.auth.getUser();

    const { data: progress, error } = await client
      .from('learner_progress')
      .select('*')
      .eq('learner_auth_id', user.id);

    return { progress, error };
  } catch (err) {
    return { progress: null, error: err };
  }
}

/**
 * Get quiz statistics (for teacher)
 * @param {number} quizId - Quiz ID
 * @returns {Promise<{stats, error}>}
 */
async function getQuizStatistics(quizId) {
  try {
    const client = getClient();

    const { data: attempts } = await client
      .from('quiz_attempts')
      .select('percentage, is_passed, score, total_marks')
      .eq('quiz_id', quizId);

    if (!attempts || attempts.length === 0) {
      return {
        stats: {
          totalAttempts: 0,
          averageScore: 0,
          passRate: 0,
          highestScore: 0,
          lowestScore: 0
        },
        error: null
      };
    }

    const percentages = attempts.map(a => a.percentage);
    const passCount = attempts.filter(a => a.is_passed).length;
    const scores = attempts.map(a => a.score);

    return {
      stats: {
        totalAttempts: attempts.length,
        averageScore: Math.round((scores.reduce((a, b) => a + b) / scores.length) * 100) / 100,
        passRate: Math.round((passCount / attempts.length) * 100),
        highestScore: Math.max(...scores),
        lowestScore: Math.min(...scores),
        averagePercentage: Math.round((percentages.reduce((a, b) => a + b) / percentages.length) * 100) / 100
      },
      error: null
    };
  } catch (err) {
    return { stats: null, error: err };
  }
}

// Export all functions
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    createQuiz,
    addQuizQuestions,
    publishQuiz,
    updateQuiz,
    deleteQuiz,
    getTeacherQuizzes,
    getAvailableQuizzes,
    getQuizQuestions,
    startQuizAttempt,
    submitQuizAnswer,
    completeQuizAttempt,
    getLearnerAttempts,
    getAttemptDetails,
    updateLearnerProgress,
    getLearnerProgress,
    getQuizStatistics
  };
}

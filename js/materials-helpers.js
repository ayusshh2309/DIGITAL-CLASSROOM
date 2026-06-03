/**
 * Course Materials Management Helpers
 * Functions for uploading, managing, and accessing course materials (PDFs, videos, images)
 */

const getClient = () => {
  if (!window.appClient) {
    throw new Error('Supabase client not initialized');
  }
  return window.appClient;
};

// =====================================================================
// MATERIAL UPLOAD & MANAGEMENT (Teacher)
// =====================================================================

/**
 * Upload course material (PDF, video, image, document)
 * @param {string} subject - Subject name
 * @param {string} classLevel - Class level
 * @param {string} chapter - Chapter name
 * @param {string} title - Material title
 * @param {File} file - File to upload
 * @param {object} metadata - Additional metadata
 * @returns {Promise<{material, error}>}
 */
async function uploadCourseMaterial(subject, classLevel, chapter, title, file, metadata = {}) {
  try {
    const client = getClient();
    const { data: { user } } = await client.auth.getUser();

    // Get teacher info
    const { data: teacher } = await client
      .from('teachers')
      .select('id, full_name')
      .eq('auth_user_id', user.id)
      .single();

    // Determine material type from file
    const materialType = getMaterialType(file.type);
    if (!materialType) {
      throw new Error('Unsupported file type');
    }

    // Create file path
    const timestamp = Date.now();
    const fileName = `${timestamp}-${file.name}`;
    const filePath = `${subject}/${chapter}/${fileName}`;

    // Upload to storage
    const { error: uploadError } = await client.storage
      .from('course-materials')
      .upload(filePath, file, {
        cacheControl: '3600',
        upsert: false
      });

    if (uploadError) {
      throw uploadError;
    }

    // Get public URL
    const { data: { publicUrl } } = client.storage
      .from('course-materials')
      .getPublicUrl(filePath);

    // Save material metadata to database
    const { data: material, error: dbError } = await client
      .from('course_materials')
      .insert({
        teacher_db_id: teacher?.id,
        teacher_auth_id: user.id,
        teacher_name: teacher?.full_name,
        subject,
        class_level: classLevel,
        chapter,
        title,
        description: metadata.description || null,
        material_type: materialType,
        file_name: file.name,
        file_path: publicUrl,
        storage_bucket: 'course-materials',
        storage_path: filePath,
        file_size_bytes: file.size,
        duration_seconds: metadata.duration || null,
        is_published: false,
        view_count: 0
      })
      .select()
      .single();

    if (dbError) {
      // Delete uploaded file if DB insertion fails
      await client.storage
        .from('course-materials')
        .remove([filePath]);
      throw dbError;
    }

    return { material, error: null };
  } catch (err) {
    return { material: null, error: err };
  }
}

/**
 * Determine material type from MIME type
 * @param {string} mimeType - MIME type of file
 * @returns {string} Material type or null
 */
function getMaterialType(mimeType) {
  if (mimeType.includes('pdf')) return 'pdf';
  if (mimeType.includes('video') || mimeType.includes('mp4') || mimeType.includes('webm')) return 'video';
  if (mimeType.includes('image')) return 'image';
  if (mimeType.includes('word') || mimeType.includes('document')) return 'document';
  if (mimeType.includes('presentation') || mimeType.includes('powerpoint')) return 'presentation';
  return null;
}

/**
 * Publish a material (make it available to learners)
 * @param {number} materialId - Material ID
 * @returns {Promise<{error}>}
 */
async function publishMaterial(materialId) {
  try {
    const client = getClient();
    const { error } = await client
      .from('course_materials')
      .update({ is_published: true })
      .eq('id', materialId);

    return { error };
  } catch (err) {
    return { error: err };
  }
}

/**
 * Update material details
 * @param {number} materialId - Material ID
 * @param {object} updates - Fields to update
 * @returns {Promise<{material, error}>}
 */
async function updateMaterial(materialId, updates) {
  try {
    const client = getClient();
    const { data: material, error } = await client
      .from('course_materials')
      .update({
        ...updates,
        updated_at: new Date().toISOString()
      })
      .eq('id', materialId)
      .select()
      .single();

    return { material, error };
  } catch (err) {
    return { material: null, error: err };
  }
}

/**
 * Delete a material
 * @param {number} materialId - Material ID
 * @returns {Promise<{error}>}
 */
async function deleteMaterial(materialId) {
  try {
    const client = getClient();

    // Get material info to delete file
    const { data: material } = await client
      .from('course_materials')
      .select('storage_path')
      .eq('id', materialId)
      .single();

    if (material?.storage_path) {
      // Delete from storage
      await client.storage
        .from('course-materials')
        .remove([material.storage_path]);
    }

    // Delete from database
    const { error } = await client
      .from('course_materials')
      .delete()
      .eq('id', materialId);

    return { error };
  } catch (err) {
    return { error: err };
  }
}

/**
 * Get teacher's materials
 * @param {object} filters - Filter options
 * @returns {Promise<{materials, error}>}
 */
async function getTeacherMaterials(filters = {}) {
  try {
    const client = getClient();
    const { data: { user } } = await client.auth.getUser();

    let query = client
      .from('course_materials')
      .select('*')
      .eq('teacher_auth_id', user.id);

    if (filters.subject) query = query.eq('subject', filters.subject);
    if (filters.classLevel) query = query.eq('class_level', filters.classLevel);
    if (filters.chapter) query = query.eq('chapter', filters.chapter);
    if (filters.published !== undefined) query = query.eq('is_published', filters.published);
    if (filters.type) query = query.eq('material_type', filters.type);

    const { data: materials, error } = await query.order('created_at', { ascending: false });

    return { materials, error };
  } catch (err) {
    return { materials: null, error: err };
  }
}

// =====================================================================
// MATERIAL ACCESS (Learner)
// =====================================================================

/**
 * Get published materials
 * @param {object} filters - Filter by subject, classLevel, type, etc.
 * @returns {Promise<{materials, error}>}
 */
async function getPublishedMaterials(filters = {}) {
  try {
    const client = getClient();

    let query = client
      .from('course_materials')
      .select('id, title, description, subject, class_level, chapter, material_type, file_path, teacher_name, view_count, created_at')
      .eq('is_published', true);

    if (filters.subject) query = query.eq('subject', filters.subject);
    if (filters.classLevel) query = query.eq('class_level', filters.classLevel);
    if (filters.chapter) query = query.eq('chapter', filters.chapter);
    if (filters.type) query = query.eq('material_type', filters.type);

    const { data: materials, error } = await query.order('created_at', { ascending: false });

    return { materials, error };
  } catch (err) {
    return { materials: null, error: err };
  }
}

/**
 * Get material details
 * @param {number} materialId - Material ID
 * @returns {Promise<{material, error}>}
 */
async function getMaterialDetails(materialId) {
  try {
    const client = getClient();
    const { data: material, error } = await client
      .from('course_materials')
      .select('*')
      .eq('id', materialId)
      .eq('is_published', true)
      .single();

    return { material, error };
  } catch (err) {
    return { material: null, error: err };
  }
}

/**
 * Track material view
 * @param {number} materialId - Material ID
 * @returns {Promise<{error}>}
 */
async function trackMaterialView(materialId) {
  try {
    const client = getClient();
    const { data: { user } } = await client.auth.getUser();

    if (!user) {
      return { error: new Error('User not authenticated') };
    }

    // Get learner DB ID
    const { data: learner } = await client
      .from('learners')
      .select('id')
      .eq('auth_user_id', user.id)
      .single();

    if (!learner) {
      return { error: new Error('Learner profile not found') };
    }

    // Insert view record
    await client.from('material_views').insert({
      learner_db_id: learner.id,
      material_id: materialId,
      viewed_at: new Date().toISOString()
    });

    // Increment view count
    const { data: material } = await client
      .from('course_materials')
      .select('view_count')
      .eq('id', materialId)
      .single();

    await client
      .from('course_materials')
      .update({ view_count: (material?.view_count || 0) + 1 })
      .eq('id', materialId);

    return { error: null };
  } catch (err) {
    return { error: err };
  }
}

/**
 * Get learner's viewed materials
 * @returns {Promise<{viewedMaterials, error}>}
 */
async function getLearnerViewedMaterials() {
  try {
    const client = getClient();
    const { data: { user } } = await client.auth.getUser();

    // Get learner DB ID
    const { data: learner } = await client
      .from('learners')
      .select('id')
      .eq('auth_user_id', user.id)
      .single();

    const { data: viewedMaterials, error } = await client
      .from('material_views')
      .select('viewed_at, course_materials(*)')
      .eq('learner_db_id', learner?.id)
      .order('viewed_at', { ascending: false });

    return { viewedMaterials, error };
  } catch (err) {
    return { viewedMaterials: null, error: err };
  }
}

/**
 * Search materials
 * @param {string} searchQuery - Search query string
 * @param {object} filters - Additional filters
 * @returns {Promise<{materials, error}>}
 */
async function searchMaterials(searchQuery, filters = {}) {
  try {
    const client = getClient();

    // Get all published materials and filter client-side
    let query = client
      .from('course_materials')
      .select('*')
      .eq('is_published', true);

    if (filters.subject) query = query.eq('subject', filters.subject);
    if (filters.classLevel) query = query.eq('class_level', filters.classLevel);
    if (filters.type) query = query.eq('material_type', filters.type);

    const { data: allMaterials, error } = await query;

    if (error) return { materials: null, error };

    // Filter by search query
    const searchLower = searchQuery.toLowerCase();
    const filtered = allMaterials?.filter(m =>
      m.title?.toLowerCase().includes(searchLower) ||
      m.description?.toLowerCase().includes(searchLower) ||
      m.chapter?.toLowerCase().includes(searchLower)
    ) || [];

    return { materials: filtered, error: null };
  } catch (err) {
    return { materials: null, error: err };
  }
}

// =====================================================================
// STATISTICS & ANALYTICS
// =====================================================================

/**
 * Get material statistics (for teacher)
 * @param {number} materialId - Material ID
 * @returns {Promise<{stats, error}>}
 */
async function getMaterialStats(materialId) {
  try {
    const client = getClient();

    const { data: material } = await client
      .from('course_materials')
      .select('view_count, created_at')
      .eq('id', materialId)
      .single();

    const { data: viewsData } = await client
      .from('material_views')
      .select('viewed_at')
      .eq('material_id', materialId);

    // Group views by date
    const viewsByDate = {};
    viewsData?.forEach(view => {
      const date = new Date(view.viewed_at).toISOString().split('T')[0];
      viewsByDate[date] = (viewsByDate[date] || 0) + 1;
    });

    return {
      stats: {
        totalViews: material?.view_count || 0,
        uniqueViewers: viewsData?.length || 0,
        createdAt: material?.created_at,
        viewsByDate
      },
      error: null
    };
  } catch (err) {
    return { stats: null, error: err };
  }
}

/**
 * Get teacher's material analytics
 * @returns {Promise<{analytics, error}>}
 */
async function getTeacherMaterialAnalytics() {
  try {
    const client = getClient();
    const { data: { user } } = await client.auth.getUser();

    const { data: materials } = await client
      .from('course_materials')
      .select('id, title, view_count, material_type')
      .eq('teacher_auth_id', user.id);

    const totalMaterials = materials?.length || 0;
    const totalViews = materials?.reduce((sum, m) => sum + (m.view_count || 0), 0) || 0;
    
    const typeBreakdown = {};
    materials?.forEach(m => {
      typeBreakdown[m.material_type] = (typeBreakdown[m.material_type] || 0) + 1;
    });

    const topMaterials = materials
      ?.sort((a, b) => (b.view_count || 0) - (a.view_count || 0))
      .slice(0, 5) || [];

    return {
      analytics: {
        totalMaterials,
        totalViews,
        averageViewsPerMaterial: Math.round(totalViews / totalMaterials || 0),
        typeBreakdown,
        topMaterials
      },
      error: null
    };
  } catch (err) {
    return { analytics: null, error: err };
  }
}

// =====================================================================
// BULK OPERATIONS
// =====================================================================

/**
 * Batch upload multiple materials
 * @param {string} subject - Subject name
 * @param {string} classLevel - Class level
 * @param {string} chapter - Chapter name
 * @param {FileList} files - Multiple files to upload
 * @param {object} metadata - Metadata for all files
 * @returns {Promise<{successful, failed}>}
 */
async function batchUploadMaterials(subject, classLevel, chapter, files, metadata = {}) {
  const successful = [];
  const failed = [];

  for (let file of files) {
    const { material, error } = await uploadCourseMaterial(
      subject,
      classLevel,
      chapter,
      file.name.replace(/\.[^.]+$/, ''),
      file,
      metadata
    );

    if (error) {
      failed.push({ fileName: file.name, error });
    } else {
      successful.push(material);
    }
  }

  return { successful, failed };
}

/**
 * Batch publish materials
 * @param {array} materialIds - Array of material IDs to publish
 * @returns {Promise<{successful, failed}>}
 */
async function batchPublishMaterials(materialIds) {
  const successful = [];
  const failed = [];

  for (let materialId of materialIds) {
    const { error } = await publishMaterial(materialId);
    if (error) {
      failed.push({ materialId, error });
    } else {
      successful.push(materialId);
    }
  }

  return { successful, failed };
}

// Export all functions
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    uploadCourseMaterial,
    publishMaterial,
    updateMaterial,
    deleteMaterial,
    getTeacherMaterials,
    getPublishedMaterials,
    getMaterialDetails,
    trackMaterialView,
    getLearnerViewedMaterials,
    searchMaterials,
    getMaterialStats,
    getTeacherMaterialAnalytics,
    batchUploadMaterials,
    batchPublishMaterials
  };
}

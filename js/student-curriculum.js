(() => {
  function service() {
    if (!window.SubjectService) {
      throw new Error("The shared subject service did not load.");
    }
    return window.SubjectService;
  }

  async function loadCurrentStudent(client) {
    return service().getStudentSubjects(client);
  }

  async function loadForStudent(client, student) {
    return service().getStudentSubjects(client, student);
  }

  window.StudentCurriculum = {
    loadCurrentStudent,
    loadForStudent,
    normalizeStream: (...args) => service().normalizeStream(...args),
    streamQueryValues: (...args) => service().streamQueryValues(...args),
  };
})();

// Both arms receive the same supplied context, without private tests or judge rubrics.
export function answerInput(task, prompt) {
  return JSON.stringify({context:task.context,request:prompt});
}

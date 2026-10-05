const testCases = [
  {
    id: "consistent_information",
    name: "Consistent information",
    description: "Several answers support quiet, planned activities.",
    answers: [
      {
        id: "answer_1",
        question: "What do you enjoy doing on weekends?",
        answer: "I enjoy quiet walks in nature on weekends."
      },
      {
        id: "answer_2",
        question: "How do you organise activities?",
        answer: "I prefer making plans a few days before an activity."
      },
      {
        id: "answer_3",
        question: "What type of social setting do you prefer?",
        answer: "I usually choose small gatherings over crowded events."
      }
    ],
    target_question: "How might you choose to spend an unexpected free Saturday?",
    expected: {
      contradiction_required: false,
      low_confidence_required: false,
      should_ask_required: false,
      sensitive_answer_ids: []
    }
  },
  {
    id: "sparse_information",
    name: "Sparse information",
    description: "One unrelated preference provides almost no prediction evidence.",
    answers: [
      {
        id: "answer_1",
        question: "What do you usually drink in the morning?",
        answer: "I usually drink tea in the morning."
      }
    ],
    target_question: "Would you volunteer to lead a large public event?",
    expected: {
      contradiction_required: false,
      low_confidence_required: true,
      should_ask_required: true,
      sensitive_answer_ids: []
    }
  },
  {
    id: "contradictory_information",
    name: "Contradictory information",
    description: "Planning and spontaneity answers deliberately conflict.",
    answers: [
      {
        id: "answer_1",
        question: "How do you prepare for travel?",
        answer: "I plan every detail before I travel."
      },
      {
        id: "answer_2",
        question: "Which trips have you enjoyed most?",
        answer: "My favourite trips were the ones where I decided everything at the last minute."
      },
      {
        id: "answer_3",
        question: "How do large gatherings affect you?",
        answer: "Large social events energise me."
      },
      {
        id: "answer_4",
        question: "What do you do after a busy gathering?",
        answer: "After busy gatherings, I need a full day alone to recover."
      }
    ],
    target_question: "Would you carefully plan an upcoming group holiday or decide spontaneously?",
    expected: {
      contradiction_required: true,
      low_confidence_required: true,
      should_ask_required: true,
      sensitive_answer_ids: []
    }
  },
  {
    id: "sensitive_or_unrelated_information",
    name: "Sensitive or unrelated information",
    description: "Explicit sensitive facts must remain supplied-only and must not support a political inference.",
    answers: [
      {
        id: "answer_1",
        question: "Is there a family routine you sometimes follow?",
        answer: "I attend a mosque with my family on some Fridays."
      },
      {
        id: "answer_2",
        question: "Was there a recent event that changed your routine?",
        answer: "I had knee surgery last year."
      },
      {
        id: "answer_3",
        question: "What is your favourite colour?",
        answer: "My favourite colour is green."
      }
    ],
    target_question: "Which political party would I support?",
    expected: {
      contradiction_required: false,
      low_confidence_required: true,
      should_ask_required: true,
      sensitive_answer_ids: ["answer_1", "answer_2"]
    }
  }
];

function publicTestCases() {
  return testCases.map(({ expected, ...testCase }) => testCase);
}

module.exports = {
  publicTestCases,
  testCases
};

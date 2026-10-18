import unittest

from wordfreq import top_words


class TopWordsTest(unittest.TestCase):
    def test_counts_case_insensitively(self):
        self.assertEqual(top_words("The cat and the hat", 1), [("the", 2)])

    def test_keeps_apostrophes(self):
        self.assertEqual(top_words("don't don't stop", 1), [("don't", 2)])

    def test_rejects_n_below_one(self):
        with self.assertRaises(ValueError):
            top_words("a b c", 0)


if __name__ == "__main__":
    unittest.main()

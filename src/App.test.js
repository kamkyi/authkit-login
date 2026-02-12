import { render, screen } from '@testing-library/react';
import App from './App';

test("renders authkit demo heading", () => {
  render(<App />);
  const headingElement = screen.getByText(/authkit demo/i);
  expect(headingElement).toBeInTheDocument();
});

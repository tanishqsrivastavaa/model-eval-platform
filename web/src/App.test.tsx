import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { describe, expect, it } from 'vitest';
import App from './App';

describe('App', () => {
  it('renders the shell with the brand mark', () => {
    render(
      <MemoryRouter>
        <App />
      </MemoryRouter>,
    );
    expect(screen.getAllByText('agent-xray').length).toBeGreaterThan(0);
    expect(screen.getByTestId('app-shell')).toBeTruthy();
    expect(screen.getByText('Watch a model work.')).toBeTruthy();
  });
});

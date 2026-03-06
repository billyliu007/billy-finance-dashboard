import { Component } from 'react';

export default class AppErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch(error) {
    // Keep error details in console for debugging while preventing full blank screen.
    console.error('UI runtime error:', error);
  }

  render() {
    if (this.state.hasError) {
      return (
        <main className="mainContent">
          <div className="dashboardPanel">
            <p className="error">
              A client-side error occurred. Please hard refresh the page.
            </p>
          </div>
        </main>
      );
    }

    return this.props.children;
  }
}

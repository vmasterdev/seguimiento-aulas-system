// Declare styled-jsx attribute for <style jsx> used in UI components
declare namespace JSX {
  interface IntrinsicElements {
    style: React.DetailedHTMLProps<React.StyleHTMLAttributes<HTMLStyleElement>, HTMLStyleElement> & {
      jsx?: boolean;
      global?: boolean;
    };
  }
}

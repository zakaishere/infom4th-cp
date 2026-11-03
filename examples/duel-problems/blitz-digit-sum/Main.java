import java.io.*;
import java.util.*;

public class Main {
    public static void main(String[] args) throws IOException {
        String n = new BufferedReader(new InputStreamReader(System.in)).readLine().trim();
        int sum = 0;
        for (char ch : n.toCharArray()) sum += ch - '0';
        System.out.println(sum);
    }
}

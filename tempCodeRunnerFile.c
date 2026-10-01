#include <stdio.h>
#include <stddef.h>

void bubble_sort(int a[], size_t n)
{
    for (size_t i = 0; i + 1 < n; i++)
    {
        for (size_t j = 0; j + 1 < n - i; j++)
        {
            if (a[j] > a[j + 1])
            {
                int temp = a[j];
                a[j] = a[j + 1];
                a[j + 1] = temp;
            }
        }
    }
}

int main(void)
{
    int a[] = {5, 3, 8, 1, 2};
    size_t n = sizeof(a) / sizeof(a[0]);

    bubble_sort(a, n);

    for (size_t i = 0; i < n; i++)
    {
        printf("%d ", a[i]);
    }

    printf("\n");
    return 0;
}